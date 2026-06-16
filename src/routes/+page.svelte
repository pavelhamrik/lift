<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import {
		mountChart,
		readTheme,
		colorForSeries,
		subscribeTooltip,
		type ChartHandles,
		type SeriesSpec,
		type TooltipPayload
	} from '$lib/chart/setup.js';
	import { pctChangeSeries } from '$lib/chart/normalize.js';
	import { createThemeStore, type ThemeMode } from '$lib/theme/mode.svelte.js';
	import {
		BENCHMARKS,
		isBenchmarkSymbol,
		isIntradayRange,
		DEFAULT_SYMBOLS,
		DEFAULT_BASIS
	} from '$lib/benchmarks.js';
	import SymbolSearch from '$lib/components/ui/SymbolSearch.svelte';
	import SeriesList from '$lib/components/ui/SeriesList.svelte';
	import AccountMenu from '$lib/components/ui/AccountMenu.svelte';
	import Logo from '$lib/components/ui/Logo.svelte';
	import OverflowMenu from '$lib/components/ui/OverflowMenu.svelte';
	import {
		RANGES,
		type Range,
		type ReturnBasis,
		type SeriesKind,
		type Asset
	} from '$lib/providers/types.js';
	import { cn } from '$lib/utils.js';
	import { createNameResolver } from '$lib/nameResolver.js';
	import { captureEvent } from '$lib/analytics/posthog.js';
	import type { SymbolSearchResult } from '$lib/symbols.js';
	import {
		parseSelectionParams,
		selectionToSearchParams,
		serializeSelection,
		serializeBasis,
		loadStoredSelection,
		isValidSymbol,
		MAX_SYMBOLS,
		SELECTION_STORAGE_KEY,
		type StoredSelection
	} from '$lib/selection.js';

	let { data: pageData } = $props();

	type ClosePoint = { time: number; close: number };
	type MultiSeries = {
		symbol: string;
		kind: SeriesKind;
		asset: 'EQUITY' | 'ETF' | 'INDEX';
		currency: string;
		aligned: ClosePoint[];
		summary: { lastPrice: number; lastPriceTime: number; pctChange?: number };
	};
	type MultiResponse = {
		series: MultiSeries[];
		primaryVolume: { symbol: string; data: { time: number; volume: number }[] };
		meta: {
			interval: '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk' | '1mo';
			session: 'regular' | 'extended';
			timezone: string;
			windowStart: number;
			windowEnd: number;
			baseTime: number;
			returnBasis: ReturnBasis;
		};
	};

	type SymbolMeta = { kind: SeriesKind; asset?: Asset; name?: string };

	let symbols = $state<string[]>([...DEFAULT_SYMBOLS]);
	let basis = $state<ReturnBasis>(DEFAULT_BASIS);
	let range = $state<Range>('1Y');
	// Partial per-symbol metadata: kind (provisional pre-load, authoritative after),
	// fine asset class, and lazily-resolved display name.
	let symbolMeta = $state<Record<string, SymbolMeta>>({});

	let loading = $state(false);
	// `reason` is a stable, enum-like code (not the human-readable title/detail) so
	// it can ride the load_error analytics event without leaking raw messages.
	type LoadErrorReason = 'rate_limited' | 'bad_request' | 'provider_down' | 'network' | 'unknown';
	type LoadError = { title: string; detail: string; retryable: boolean; reason: LoadErrorReason };
	let loadError = $state<LoadError | null>(null);
	// Bumped per request so only the most recent load commits its result.
	let loadSeq = 0;
	// Count of requests currently awaiting the network (foreground + background);
	// gates auto-refresh so it never overlaps an in-flight load.
	let inFlight = 0;
	// Aborts the request that a newer load() supersedes, so a stale request never
	// finishes its round-trip (and never buffers a body that the seq-guard would
	// just discard). Distinct from `inFlight` above despite the similar name.
	let inflightAbort: AbortController | null = null;
	// Set when a background auto-refresh fails; surfaced as a non-blocking notice
	// while the last successful data stays on screen.
	let refreshFailed = $state(false);
	let data = $state<MultiResponse | null>(null);
	let shareCopied = $state(false);
	let shareTimer: ReturnType<typeof setTimeout> | null = null;

	// Auto-refresh the current selection once a minute, but only while the tab is
	// in the foreground (a backgrounded tab shouldn't keep hitting the API). When
	// the tab comes back to the foreground after missing at least one cycle, we
	// fetch immediately to catch up.
	const AUTO_REFRESH_MS = 60_000;
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	let lastLoadAt = 0;

	const theme = createThemeStore();
	const themeOptions: ThemeMode[] = ['system', 'light', 'dark'];

	let chartEl: HTMLDivElement | undefined = $state();
	let handles: ChartHandles | null = null;
	let tooltip = $state<TooltipPayload>(null);
	let tooltipUnsub: (() => void) | null = null;

	// Bounded, memoized, in-flight-deduped name resolution. The chart never needs
	// names, so this only fills in row labels on demand without a cold-link burst.
	const nameResolver = createNameResolver(async (sym) => {
		try {
			const r = await fetch(`/api/lookup?symbol=${encodeURIComponent(sym)}`);
			if (!r.ok) return null;
			const body = (await r.json()) as { name?: string };
			return body.name ?? null;
		} catch {
			return null;
		}
	});

	/** Provisional kind before the server confirms: curated indices → index, else equity. */
	function provisionalKind(symbol: string): SeriesKind {
		return isBenchmarkSymbol(symbol) && BENCHMARKS[symbol].asset === 'INDEX' ? 'index' : 'equity';
	}

	function kindFor(symbol: string): SeriesKind {
		return symbolMeta[symbol]?.kind ?? provisionalKind(symbol);
	}

	function nameFor(symbol: string): string | undefined {
		return symbolMeta[symbol]?.name;
	}

	function summaryFor(symbol: string): number | undefined {
		return data?.series.find((s) => s.symbol === symbol)?.summary.pctChange;
	}

	// Colors are assigned by position within kind over the ordered symbol list, so
	// the gray palette is reached only by true indices.
	const seriesColors = $derived.by(() => {
		const root = browser ? document.documentElement : undefined;
		const map: Record<string, string> = {};
		let equityIdx = 0;
		let indexIdx = 0;
		for (const sym of symbols) {
			const k = kindFor(sym);
			const i = k === 'index' ? indexIdx++ : equityIdx++;
			map[sym] = root ? colorForSeries(k, i, root) : k === 'index' ? '#6b7280' : '#0ea5e9';
		}
		return map;
	});

	function colorFor(symbol: string): string {
		return seriesColors[symbol] ?? '#888888';
	}

	function requestName(symbol: string) {
		if (symbolMeta[symbol]?.name) return;
		void nameResolver.resolve(symbol).then((name) => {
			if (!name) return;
			symbolMeta = {
				...symbolMeta,
				[symbol]: { ...(symbolMeta[symbol] ?? { kind: provisionalKind(symbol) }), name }
			};
		});
	}

	function formatTooltipTime(t: number, tz: string, interval: string): string {
		const d = new Date(t * 1000);
		const opts: Intl.DateTimeFormatOptions = isIntraday(interval)
			? {
					year: 'numeric',
					month: 'short',
					day: '2-digit',
					hour: '2-digit',
					minute: '2-digit',
					timeZone: tz,
					hour12: false
				}
			: { year: 'numeric', month: 'short', day: '2-digit', timeZone: tz };
		try {
			return new Intl.DateTimeFormat('en-US', opts).format(d);
		} catch {
			return d.toISOString();
		}
	}

	function formatVolume(n: number): string {
		const abs = Math.abs(n);
		if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
		if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
		if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
		return n.toFixed(0);
	}

	function pctClass(v: number | undefined): string {
		if (v === undefined) return 'text-(--color-muted-foreground)';
		if (v > 0) return 'text-(--color-up)';
		if (v < 0) return 'text-(--color-down)';
		return 'text-(--color-foreground)';
	}

	const tooltipStyle = $derived.by(() => {
		if (!tooltip || !chartEl) return '';
		const w = chartEl.clientWidth;
		const h = chartEl.clientHeight;
		const tipW = 220;
		const tipCount =
			tooltip.values.length + (tooltip.volume !== undefined && tooltip.volume > 0 ? 1 : 0);
		const tipH = 56 + tipCount * 22;
		const margin = 12;
		const right = tooltip.x + margin + tipW > w;
		const bottom = tooltip.y + margin + tipH > h;
		const left = right ? tooltip.x - margin - tipW : tooltip.x + margin;
		const top = bottom ? tooltip.y - margin - tipH : tooltip.y + margin;
		return `left: ${Math.max(8, left)}px; top: ${Math.max(8, top)}px;`;
	});

	function formatPct(v: number, decimals = 2): string {
		const sign = v > 0 ? '+' : '';
		return `${sign}${v.toFixed(decimals)}%`;
	}

	function isIntraday(i: string): boolean {
		return i === '1m' || i === '5m' || i === '15m' || i === '30m' || i === '1h';
	}

	function currentSelection(): StoredSelection {
		return { symbols: [...symbols], basis, range };
	}

	function persistSelection() {
		if (!browser) return;
		try {
			localStorage.setItem(SELECTION_STORAGE_KEY, serializeSelection(currentSelection()));
		} catch {
			/* ignore quota / disabled storage */
		}
	}

	function syncUrl() {
		if (!browser) return;
		const params = selectionToSearchParams(currentSelection());
		try {
			// replaceState (not pushState) so the address bar stays shareable without
			// polluting history; pass the existing state to keep SvelteKit's router happy.
			window.history.replaceState(
				window.history.state,
				'',
				`${window.location.pathname}?${params.toString()}`
			);
		} catch {
			/* ignore */
		}
	}

	async function share() {
		const params = selectionToSearchParams(currentSelection());
		const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			/* clipboard may be blocked; the link is still live in the address bar */
		}
		shareCopied = true;
		captureEvent('selection_shared', { symbols: symbols.length });
		if (shareTimer) clearTimeout(shareTimer);
		shareTimer = setTimeout(() => {
			shareCopied = false;
		}, 1500);
	}

	// Turn an API failure (HTTP status + body) into a human-readable panel.
	// The server uses SvelteKit's error(), so the body is usually {"message":"…"}.
	function describeError(status: number, raw: string): LoadError {
		let msg = raw.trim();
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed.message === 'string') msg = parsed.message.trim();
		} catch {
			/* not JSON — fall back to the raw text */
		}

		if (status === 429) {
			return {
				title: 'Too many requests',
				detail:
					'You’ve sent a lot of requests in a short time. Wait a few seconds, then try again.',
				retryable: true,
				reason: 'rate_limited'
			};
		}
		if (status === 400) {
			return {
				title: 'Check your selection',
				detail: msg || 'One of the selected symbols isn’t supported.',
				retryable: false,
				reason: 'bad_request'
			};
		}
		if (status >= 500) {
			return {
				title: 'Couldn’t reach the data provider',
				detail:
					'The market-data source didn’t respond, or none of these symbols had data over this range. This is usually temporary, try again in a moment.',
				retryable: true,
				reason: 'provider_down'
			};
		}
		return {
			title: 'Something went wrong',
			detail: msg || 'An unexpected error occurred. Please try again.',
			retryable: true,
			reason: 'unknown'
		};
	}

	async function load(opts: { background?: boolean } = {}) {
		const { background = false } = opts;
		// Cancel any still-in-flight request before starting a new one — including
		// before bailing on an empty selection, so clearing all symbols aborts a
		// pending load rather than letting it commit stale data afterwards.
		inflightAbort?.abort();
		inflightAbort = new AbortController();
		const signal = inflightAbort.signal;
		if (symbols.length === 0) {
			data = null;
			loadError = null;
			refreshFailed = false;
			return;
		}
		// Every request gets a monotonic id; only the latest one is allowed to
		// commit its result, so a slow in-flight request can't overwrite the chart
		// with stale data after the selection has already moved on.
		const seq = ++loadSeq;
		inFlight++;
		// Foreground loads show the spinner and clear prior state. Background
		// refreshes are silent and must never blow away valid data on failure.
		if (!background) {
			loading = true;
			loadError = null;
			refreshFailed = false;
		}
		try {
			const u = new URL('/api/history-multi', window.location.origin);
			u.searchParams.set('symbols', symbols.join(','));
			u.searchParams.set('basis', serializeBasis(basis));
			u.searchParams.set('range', range);
			const r = await fetch(u, { signal });
			if (seq !== loadSeq) return; // superseded by a newer request
			if (!r.ok) {
				if (background) {
					refreshFailed = true;
					return;
				}
				// Read the body before touching state, then re-check: a newer request
				// can finish successfully while this error body streams in, and we must
				// not erase its result with a stale failure.
				const body = await r.text();
				if (seq !== loadSeq) return;
				loadError = describeError(r.status, body);
				captureEvent('load_error', { reason: loadError.reason });
				data = null;
				return;
			}
			const next = (await r.json()) as MultiResponse;
			if (seq !== loadSeq) return; // superseded while the body streamed in
			data = next;
			reconcileMeta(next);
			refreshFailed = false;
			renderChart();
			persistSelection();
			syncUrl();
		} catch (e) {
			// A deliberate cancel (a newer load superseded this one, or the component
			// is tearing down) must never flip error state or the refresh notice.
			if ((e as { name?: string } | null)?.name === 'AbortError') return;
			if (seq !== loadSeq) return;
			if (background) {
				refreshFailed = true;
			} else {
				loadError = {
					title: 'Connection problem',
					detail: 'Couldn’t reach the server. Check your connection and try again.',
					retryable: true,
					reason: 'network'
				};
				captureEvent('load_error', { reason: loadError.reason });
				data = null;
			}
		} finally {
			inFlight--;
			if (seq === loadSeq) {
				// Stamp completion, not start: the API caches the response when it
				// lands, so timing the next poll from here avoids re-fetching a
				// still-cached payload and roughly doubling the effective staleness.
				lastLoadAt = Date.now();
				if (!background) loading = false;
				// Reset the poll clock on every completed load (manual, selection, or
				// background) so the next auto-refresh is always a full interval later.
				scheduleAutoRefresh();
			}
		}
	}

	// Reconcile provisional kind/asset with the server's authoritative values.
	function reconcileMeta(res: MultiResponse) {
		const next = { ...symbolMeta };
		for (const s of res.series) {
			next[s.symbol] = { ...(next[s.symbol] ?? {}), kind: s.kind, asset: s.asset };
		}
		symbolMeta = next;
	}

	function clearRefreshTimer() {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
	}

	// Schedule the next background refresh `delay` ms out. Driven from load()'s
	// finally (so the clock runs from each load's completion) and from foregrounding
	// (to resume polling). Self-rescheduling keeps a steady cadence without a fixed
	// interval drifting against request latency, and only ever runs while visible.
	function scheduleAutoRefresh(delay = AUTO_REFRESH_MS) {
		clearRefreshTimer();
		if (!browser || document.visibilityState !== 'visible') return;
		refreshTimer = setTimeout(() => {
			if (document.visibilityState === 'visible' && inFlight === 0) {
				void load({ background: true }); // its finally schedules the next poll
			} else {
				scheduleAutoRefresh(); // busy or hidden right now — try again later
			}
		}, delay);
	}

	function handleVisibilityChange() {
		if (document.visibilityState === 'visible') {
			const elapsed = Date.now() - lastLoadAt;
			if (inFlight === 0 && elapsed >= AUTO_REFRESH_MS) {
				// Missed at least one cycle while hidden — refresh now; its finally
				// reschedules the next poll.
				void load({ background: true });
			} else {
				// Resume polling for whatever is left of the current cycle.
				scheduleAutoRefresh(Math.max(0, AUTO_REFRESH_MS - elapsed));
			}
		} else {
			clearRefreshTimer();
		}
	}

	function renderChart() {
		if (!handles || !data) return;
		const baseTime = data.meta.baseTime;
		const specs: SeriesSpec[] = data.series.map((s) => ({
			symbol: s.symbol,
			kind: s.kind,
			color: colorFor(s.symbol),
			data: pctChangeSeries(s.aligned, baseTime)
		}));
		handles.setSeries(specs);
		handles.setVolume(data.primaryVolume.data);
	}

	function getAnchorSymbol(): string | undefined {
		return data?.primaryVolume.symbol;
	}

	function addSymbol(result: SymbolSearchResult) {
		const sym = result.symbol.trim().toUpperCase();
		if (!isValidSymbol(sym)) return;
		if (symbols.includes(sym)) return; // already present — no-op (R1.3)
		if (symbols.length >= MAX_SYMBOLS) return;
		symbols = [...symbols, sym];
		symbolMeta = {
			...symbolMeta,
			[sym]: {
				kind: result.kind,
				asset: result.asset,
				name: result.name || symbolMeta[sym]?.name
			}
		};
		void load();
	}

	function removeSymbol(sym: string) {
		if (symbols.length <= 1) return;
		symbols = symbols.filter((x) => x !== sym);
		captureEvent('symbol_removed', { symbol: sym });
		void load();
	}

	function setBasis(next: ReturnBasis) {
		if (next === basis) return;
		basis = next;
		void load();
	}

	function resetSelection() {
		symbols = [...DEFAULT_SYMBOLS];
		basis = DEFAULT_BASIS;
		captureEvent('selection_reset');
		void load();
	}

	function applySelection(sel: StoredSelection) {
		symbols = [...sel.symbols];
		basis = sel.basis;
		range = sel.range;
		void load();
	}

	onMount(() => {
		if (!chartEl) return;
		try {
			// A shared link (?symbols=…&basis=…&range=…) wins over saved local state.
			const fromUrl = parseSelectionParams(new URLSearchParams(window.location.search));
			const stored = fromUrl ?? loadStoredSelection(localStorage);
			if (stored) {
				symbols = stored.symbols;
				basis = stored.basis;
				range = stored.range;
			}
		} catch {
			/* ignore */
		}
		handles = mountChart(chartEl, readTheme());
		tooltipUnsub = subscribeTooltip(handles, chartEl, getAnchorSymbol, (p) => {
			tooltip = p;
		});
		void load(); // its finally schedules the first auto-refresh
		document.addEventListener('visibilitychange', handleVisibilityChange);
	});

	$effect(() => {
		// Read theme.resolved so this effect re-runs when the mode flips (it's always
		// truthy, so the guard's behavior is unchanged).
		const resolved = theme.resolved;
		if (resolved && handles && browser) {
			handles.applyTheme(readTheme());
			// Re-apply colors since some palette slots come from CSS vars.
			if (data) renderChart();
		}
	});

	onDestroy(() => {
		tooltipUnsub?.();
		handles?.dispose();
		theme.destroy();
		clearRefreshTimer();
		inflightAbort?.abort();
		if (browser) document.removeEventListener('visibilitychange', handleVisibilityChange);
		if (shareTimer) clearTimeout(shareTimer);
	});
</script>

<svelte:head>
	<title>Lift</title>
	<meta name="description" content="Compare stocks vs benchmarks on normalized return + volume" />
</svelte:head>

<div class="flex min-h-screen flex-col">
	<header class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
		<!-- Deliberately not a link: this is the app's only page, and navigating to "/"
		     would drop the symbols/range/basis carried in the URL query — the exact
		     state people copy to share. The docs pages keep a clickable logo home. -->
		<div class="order-1 mr-1 inline-flex shrink-0 items-center">
			<Logo class="h-5 w-auto text-(--color-foreground)" />
		</div>

		<div class="order-3 w-full min-w-0 sm:order-2 sm:flex sm:w-auto sm:flex-1 sm:justify-center">
			<SymbolSearch selected={symbols} disabled={symbols.length >= MAX_SYMBOLS} onAdd={addSymbol} />
		</div>

		<div class="order-2 ml-auto inline-flex shrink-0 items-center gap-2 sm:order-3">
			{#if pageData.supabase}
				<AccountMenu
					supabase={pageData.supabase}
					user={pageData.user}
					selection={currentSelection()}
					onLoad={applySelection}
				/>
			{/if}

			<button
				type="button"
				title={shareCopied ? 'Link copied' : 'Copy shareable link'}
				aria-label="Copy shareable link"
				onclick={() => void share()}
				class={cn(
					'inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-medium',
					'bg-(--color-card) text-(--color-card-foreground) hover:bg-(--color-muted)',
					'border-(--color-input) transition-[color,box-shadow]',
					'focus-ring'
				)}
			>
				{#if shareCopied}
					<svg
						viewBox="0 0 24 24"
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M20 6L9 17l-5-5" />
					</svg>
					Copied
				{:else}
					<svg
						viewBox="0 0 24 24"
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
						<polyline points="16 6 12 2 8 6" />
						<line x1="12" x2="12" y1="2" y2="15" />
					</svg>
					Share
				{/if}
			</button>

			<a
				href="https://github.com/pavelhamrik/lift"
				target="_blank"
				rel="noopener"
				title="View source on GitHub"
				aria-label="View source on GitHub"
				class={cn(
					'inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm',
					'bg-(--color-card) text-(--color-card-foreground) hover:bg-(--color-muted)',
					'border-(--color-input) transition-[color,box-shadow]',
					'focus-ring'
				)}
			>
				<svg viewBox="0 0 16 16" class="h-4 w-4" fill="currentColor" aria-hidden="true">
					<path
						d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
					/>
				</svg>
			</a>

			<OverflowMenu
				onReset={resetSelection}
				{theme}
				{themeOptions}
				{basis}
				onBasisChange={setBasis}
				intraday={isIntradayRange(range)}
			/>
		</div>
	</header>

	<section class="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 pb-4 sm:px-6">
		<SeriesList
			{symbols}
			{kindFor}
			{colorFor}
			{summaryFor}
			{nameFor}
			onRemove={removeSymbol}
			onRequestName={requestName}
		/>

		<div class="ml-auto inline-flex items-center gap-0.5" role="radiogroup" aria-label="Time range">
			{#each RANGES as r (r)}
				<button
					type="button"
					role="radio"
					aria-checked={range === r}
					class={cn(
						'inline-flex h-7 items-center justify-center rounded-full px-2.5 text-xs font-medium transition-colors',
						r !== 'MAX' && 'tracking-wide',
						range === r
							? 'bg-(--color-accent) text-(--color-foreground)'
							: 'text-(--color-muted-foreground) hover:bg-(--color-accent) hover:text-(--color-foreground)'
					)}
					onclick={(e) => {
						if (range !== r) captureEvent('range_changed', { range: r });
						range = r;
						(e.currentTarget as HTMLButtonElement).blur();
						void load();
					}}
				>
					{r}
				</button>
			{/each}
		</div>
	</section>

	<section class="flex min-h-[420px] flex-1 flex-col px-4 pb-6 sm:px-6">
		<div class="relative flex-1">
			<div
				bind:this={chartEl}
				class="absolute inset-0 w-full overflow-hidden rounded-[0.75rem] border bg-(--color-card)"
				style="border-color: var(--color-border)"
			></div>
			{#if refreshFailed && data}
				<div
					class="absolute top-2 right-2 z-10 inline-flex items-center gap-1.5 rounded-full border bg-(--color-card) px-3 py-1 text-xs text-(--color-muted-foreground) shadow-sm"
					style="border-color: var(--color-border)"
					role="status"
				>
					<svg
						viewBox="0 0 24 24"
						class="h-3.5 w-3.5 shrink-0"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path
							d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
						/>
						<line x1="12" y1="9" x2="12" y2="13" />
						<line x1="12" y1="17" x2="12.01" y2="17" />
					</svg>
					<span>Couldn’t refresh — showing last update</span>
				</div>
			{/if}
			{#if loadError || !data}
				<div
					class="absolute inset-0 z-20 flex items-center justify-center overflow-hidden rounded-[0.75rem] border bg-(--color-card) px-6"
					style="border-color: var(--color-border)"
				>
					{#if loadError}
						<div class="flex max-w-sm flex-col items-center gap-3 text-center">
							<div
								class="flex h-15 w-15 items-center justify-center rounded-full"
								style="color: var(--color-destructive); background: color-mix(in srgb, var(--color-destructive) 12%, transparent)"
							>
								<svg
									width="30"
									height="30"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path
										d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
									/>
									<line x1="12" y1="9" x2="12" y2="13" />
									<line x1="12" y1="17" x2="12.01" y2="17" />
								</svg>
							</div>
							<div class="text-base font-medium text-(--color-foreground)">
								{loadError.title}
							</div>
							<p class="text-sm leading-relaxed text-(--color-muted-foreground)">
								{loadError.detail}
							</p>
							{#if loadError.retryable}
								<button
									type="button"
									onclick={() => void load()}
									disabled={loading}
									class="mt-1 inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors hover:bg-(--color-accent) disabled:opacity-60"
									style="border-color: var(--color-border)"
								>
									<svg
										class={loading ? 'animate-spin' : ''}
										width="15"
										height="15"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.75"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M21 12a9 9 0 1 1-2.64-6.36" />
										<path d="M21 3v6h-6" />
									</svg>
									{loading ? 'Retrying…' : 'Try again'}
								</button>
							{/if}
						</div>
					{:else}
						<div
							class="flex flex-col items-center gap-2 text-center text-sm text-(--color-muted-foreground)"
						>
							{#if loading}
								<svg
									class="animate-spin"
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									aria-hidden="true"
								>
									<path d="M21 12a9 9 0 1 1-6.219-8.56" />
								</svg>
								<span>Loading…</span>
							{:else}
								<span>Add a symbol to begin.</span>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
			{#if tooltip && data}
				<div
					class="pointer-events-none absolute z-10 w-[220px] rounded-[var(--radius)] border bg-(--color-popover) p-3 text-xs shadow-md"
					style="border-color: var(--color-border); {tooltipStyle}"
				>
					<div class="mb-2 text-[11px] text-(--color-muted-foreground)">
						{formatTooltipTime(tooltip.time, data.meta.timezone, data.meta.interval)}
					</div>
					<div class="flex flex-col gap-1">
						{#each tooltip.values as v (v.symbol)}
							<div class="flex items-baseline justify-between gap-3">
								<span class="flex items-center gap-1.5 truncate">
									<span
										class="inline-block h-2 w-2 shrink-0 rounded-full"
										style="background: {v.color}"
									></span>
									<span class="text-(--color-foreground)">{v.symbol}</span>
								</span>
								<span class={cn('font-medium tabular-nums', pctClass(v.value))}>
									{v.value !== undefined ? formatPct(v.value) : '—'}
								</span>
							</div>
						{/each}
						{#if tooltip.volume !== undefined && tooltip.volume > 0}
							<div
								class="mt-1 flex items-baseline justify-between gap-3 border-t pt-1.5"
								style="border-color: var(--color-border)"
							>
								<span class="text-(--color-muted-foreground)">
									Volume · {data.primaryVolume.symbol}
								</span>
								<span class="text-(--color-foreground) tabular-nums">
									{formatVolume(tooltip.volume)}
								</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</section>
</div>
