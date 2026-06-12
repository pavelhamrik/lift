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
	import { isBenchmarkSymbol, type BenchmarkSymbol } from '$lib/benchmarks.js';
	import CompareAddMenu from '$lib/components/ui/CompareAddMenu.svelte';
	import AccountMenu from '$lib/components/ui/AccountMenu.svelte';
	import Logo from '$lib/components/ui/Logo.svelte';
	import OverflowMenu from '$lib/components/ui/OverflowMenu.svelte';
	import { RANGES, type Range } from '$lib/providers/types.js';
	import { cn } from '$lib/utils.js';
	import {
		parseSelectionParams,
		selectionToSearchParams,
		serializeSelection,
		loadStoredSelection,
		SELECTION_STORAGE_KEY,
		type StoredSelection
	} from '$lib/selection.js';

	let { data: pageData } = $props();

	type ClosePoint = { time: number; close: number };
	type SeriesKind = 'stock' | 'comparison';
	type MultiSeries = {
		symbol: string;
		kind: SeriesKind;
		currency: string;
		aligned: ClosePoint[];
		summary: { lastPrice: number; lastPriceTime: number; pctChange: number };
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
			returnBasis: 'price-only' | 'total-return' | 'mixed';
		};
	};

	const DEFAULT_STOCKS = ['AAPL'];
	const DEFAULT_COMPARES: BenchmarkSymbol[] = ['SPY'];
	const SYMBOL_RE = /^[A-Z\^.\-]{1,8}$/;
	const MAX_STOCKS = 8;
	const MAX_COMPARES = 8;

	let stocks = $state<string[]>([...DEFAULT_STOCKS]);
	let compares = $state<BenchmarkSymbol[]>([...DEFAULT_COMPARES]);
	let range = $state<Range>('1Y');
	let stockInput = $state('');
	let stockInputError = $state<string | null>(null);
	let loading = $state(false);
	type LoadError = { title: string; detail: string; retryable: boolean };
	let loadError = $state<LoadError | null>(null);
	let data = $state<MultiResponse | null>(null);
	let shareCopied = $state(false);
	let shareTimer: ReturnType<typeof setTimeout> | null = null;

	// Auto-refresh the current selection once a minute, but only while the tab is
	// in the foreground (a backgrounded tab shouldn't keep hitting the API). When
	// the tab comes back to the foreground after missing at least one cycle, we
	// fetch immediately to catch up.
	const AUTO_REFRESH_MS = 60_000;
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let lastLoadAt = 0;

	type LookupStatus = 'idle' | 'loading' | 'found' | 'notfound' | 'error';
	let lookupStatus = $state<LookupStatus>('idle');
	let lookupName = $state<string | null>(null);
	let lookupSeq = 0;
	let lookupTimer: ReturnType<typeof setTimeout> | null = null;

	const theme = createThemeStore();
	const themeOptions: ThemeMode[] = ['system', 'light', 'dark'];

	let chartEl: HTMLDivElement | undefined = $state();
	let handles: ChartHandles | null = null;
	let tooltip = $state<TooltipPayload>(null);
	let tooltipUnsub: (() => void) | null = null;

	const seriesColors = $derived.by(() => {
		const root = browser ? document.documentElement : undefined;
		const map = new Map<string, string>();
		stocks.forEach((s, i) => {
			map.set(s, root ? colorForSeries('stock', i, root) : '#0ea5e9');
		});
		compares.forEach((c, i) => {
			map.set(c, root ? colorForSeries('comparison', i, root) : '#6b7280');
		});
		return map;
	});

	function colorFor(symbol: string): string {
		return seriesColors.get(symbol) ?? '#888888';
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

	function formatPrice(v: number, currency: string): string {
		try {
			return new Intl.NumberFormat('en-US', {
				style: 'currency',
				currency,
				maximumFractionDigits: 2
			}).format(v);
		} catch {
			return v.toFixed(2);
		}
	}

	function formatPct(v: number, decimals = 2): string {
		const sign = v > 0 ? '+' : '';
		return `${sign}${v.toFixed(decimals)}%`;
	}

	function isIntraday(i: string): boolean {
		return i === '1m' || i === '5m' || i === '15m' || i === '30m' || i === '1h';
	}

	function formatLastTime(t: number, tz: string, interval: string): string {
		const d = new Date(t * 1000);
		const opts: Intl.DateTimeFormatOptions = isIntraday(interval)
			? { hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false }
			: { year: 'numeric', month: 'short', day: '2-digit', timeZone: tz };
		try {
			return new Intl.DateTimeFormat('en-US', opts).format(d);
		} catch {
			return d.toISOString();
		}
	}

	function persistSelection() {
		if (!browser) return;
		try {
			localStorage.setItem(
				SELECTION_STORAGE_KEY,
				serializeSelection({ stocks: [...stocks], compares: [...compares], range })
			);
		} catch {
			/* ignore quota / disabled storage */
		}
	}

	function syncUrl() {
		if (!browser) return;
		const params = selectionToSearchParams({ stocks: [...stocks], compares: [...compares], range });
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
		const params = selectionToSearchParams({ stocks: [...stocks], compares: [...compares], range });
		const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			/* clipboard may be blocked; the link is still live in the address bar */
		}
		shareCopied = true;
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

		if (/no overlapping bars/i.test(msg)) {
			return {
				title: 'No overlapping history',
				detail:
					'These symbols don’t share enough common trading days over this range. Try a longer range, or remove one of them.',
				retryable: false
			};
		}
		if (status === 429) {
			return {
				title: 'Too many requests',
				detail:
					'You’ve sent a lot of requests in a short time. Wait a few seconds, then try again.',
				retryable: true
			};
		}
		if (status === 400) {
			return {
				title: 'Check your selection',
				detail: msg || 'One of the selected symbols isn’t supported.',
				retryable: false
			};
		}
		if (status >= 500) {
			return {
				title: 'Couldn’t reach the data provider',
				detail:
					'The market-data source didn’t respond. This is usually temporary, try again in a moment.',
				retryable: true
			};
		}
		return {
			title: 'Something went wrong',
			detail: msg || 'An unexpected error occurred. Please try again.',
			retryable: true
		};
	}

	async function load() {
		if (stocks.length === 0) {
			data = null;
			loadError = null;
			return;
		}
		lastLoadAt = Date.now();
		loading = true;
		loadError = null;
		try {
			const u = new URL('/api/history-multi', window.location.origin);
			u.searchParams.set('stocks', stocks.join(','));
			u.searchParams.set('compares', compares.join(','));
			u.searchParams.set('range', range);
			const r = await fetch(u);
			if (!r.ok) {
				loadError = describeError(r.status, await r.text());
				data = null;
				return;
			}
			data = (await r.json()) as MultiResponse;
			renderChart();
			persistSelection();
			syncUrl();
		} catch {
			loadError = {
				title: 'Connection problem',
				detail: 'Couldn’t reach the server. Check your connection and try again.',
				retryable: true
			};
			data = null;
		} finally {
			loading = false;
		}
	}

	function stopAutoRefresh() {
		if (refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = null;
		}
	}

	function startAutoRefresh() {
		stopAutoRefresh();
		if (!browser || document.visibilityState !== 'visible') return;
		refreshTimer = setInterval(() => {
			// Poll only a visible tab, and never overlap an in-flight request.
			if (document.visibilityState === 'visible' && !loading) void load();
		}, AUTO_REFRESH_MS);
	}

	function handleVisibilityChange() {
		if (document.visibilityState === 'visible') {
			// Catch up on return if we skipped at least one refresh cycle while hidden.
			if (!loading && Date.now() - lastLoadAt >= AUTO_REFRESH_MS) void load();
			startAutoRefresh();
		} else {
			stopAutoRefresh();
		}
	}

	function renderChart() {
		if (!handles || !data) return;
		const specs: SeriesSpec[] = data.series.map((s) => ({
			symbol: s.symbol,
			kind: s.kind,
			color: colorFor(s.symbol),
			data: pctChangeSeries(s.aligned)
		}));
		handles.setSeries(specs);
		handles.setVolume(data.primaryVolume.data);
	}

	function getAnchorSymbol(): string | undefined {
		return stocks[0];
	}

	function addStock() {
		stockInputError = null;
		const v = stockInput.trim().toUpperCase();
		if (!v) return;
		if (!SYMBOL_RE.test(v)) {
			stockInputError = 'Invalid ticker';
			return;
		}
		if (stocks.includes(v)) {
			stockInputError = 'Already added';
			return;
		}
		if (stocks.length >= MAX_STOCKS) {
			stockInputError = `Max ${MAX_STOCKS}`;
			return;
		}
		stocks = [...stocks, v];
		stockInput = '';
		void load();
	}

	function removeStock(s: string) {
		if (stocks.length <= 1) return;
		stocks = stocks.filter((x) => x !== s);
		void load();
	}

	function addCompare(sym: BenchmarkSymbol) {
		if (compares.includes(sym)) return;
		if (compares.length >= MAX_COMPARES) return;
		compares = [...compares, sym];
		void load();
	}

	function removeCompare(sym: BenchmarkSymbol) {
		compares = compares.filter((x) => x !== sym);
		void load();
	}

	function resetSelection() {
		stocks = [...DEFAULT_STOCKS];
		compares = [...DEFAULT_COMPARES];
		stockInput = '';
		stockInputError = null;
		void load();
	}

	function applySelection(sel: StoredSelection) {
		stocks = [...sel.stocks];
		compares = [...sel.compares];
		range = sel.range;
		stockInput = '';
		stockInputError = null;
		void load();
	}

	function onStockKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addStock();
		}
	}

	async function runLookup(sym: string, seq: number) {
		try {
			const r = await fetch(`/api/lookup?symbol=${encodeURIComponent(sym)}`);
			if (seq !== lookupSeq) return;
			if (r.status === 404) {
				lookupName = null;
				lookupStatus = 'notfound';
				return;
			}
			if (!r.ok) {
				lookupStatus = 'error';
				return;
			}
			const body = (await r.json()) as { symbol: string; name: string };
			if (seq !== lookupSeq) return;
			lookupName = body.name;
			lookupStatus = 'found';
		} catch {
			if (seq !== lookupSeq) return;
			lookupStatus = 'error';
		}
	}

	$effect(() => {
		const trimmed = stockInput.trim().toUpperCase();
		lookupSeq++;
		if (lookupTimer) {
			clearTimeout(lookupTimer);
			lookupTimer = null;
		}
		if (!trimmed || !SYMBOL_RE.test(trimmed) || stocks.includes(trimmed)) {
			lookupStatus = 'idle';
			lookupName = null;
			return;
		}
		lookupStatus = 'loading';
		const seq = lookupSeq;
		lookupTimer = setTimeout(() => {
			void runLookup(trimmed, seq);
		}, 300);
	});

	onMount(() => {
		if (!chartEl) return;
		try {
			// A shared link (?stocks=…&compares=…&range=…) wins over saved local state.
			const fromUrl = parseSelectionParams(new URLSearchParams(window.location.search));
			const stored = fromUrl ?? loadStoredSelection(localStorage);
			if (stored) {
				stocks = stored.stocks;
				compares = stored.compares;
				range = stored.range;
			}
		} catch {
			/* ignore */
		}
		handles = mountChart(chartEl, readTheme());
		tooltipUnsub = subscribeTooltip(handles, chartEl, getAnchorSymbol, (p) => {
			tooltip = p;
		});
		void load();
		document.addEventListener('visibilitychange', handleVisibilityChange);
		startAutoRefresh();
	});

	$effect(() => {
		const _ = theme.resolved;
		if (handles && browser) {
			handles.applyTheme(readTheme());
			// Re-apply colors since some palette slots come from CSS vars.
			if (data) renderChart();
		}
	});

	onDestroy(() => {
		tooltipUnsub?.();
		handles?.dispose();
		theme.destroy();
		stopAutoRefresh();
		if (browser) document.removeEventListener('visibilitychange', handleVisibilityChange);
		if (shareTimer) clearTimeout(shareTimer);
	});

	const primarySeries = $derived.by(() => data?.series.find((s) => s.kind === 'stock'));
</script>

<svelte:head>
	<title>Lift</title>
	<meta name="description" content="Compare stocks vs benchmarks on normalized return + volume" />
</svelte:head>

<div class="flex min-h-screen flex-col">
	<header class="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
		<a href="/" aria-label="Lift home" class="mr-1 inline-flex shrink-0 items-center">
			<Logo class="h-5 w-auto text-(--color-foreground)" />
		</a>

		<div class="flex flex-wrap items-center gap-1.5">
			{#each stocks as s (s)}
				<span
					class="inline-flex h-7 items-center gap-1.5 rounded-full border pr-1 pl-2.5 text-xs font-medium tabular-nums"
					style="border-color: var(--color-border)"
				>
					<span
						class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
						style="background: {colorFor(s)}"
					></span>
					<span class="text-(--color-foreground)">{s}</span>
					<button
						type="button"
						aria-label={`Remove ${s}`}
						title={stocks.length <= 1 ? 'At least one stock required' : `Remove ${s}`}
						disabled={stocks.length <= 1}
						onclick={() => removeStock(s)}
						class={cn(
							'inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors',
							'text-(--color-muted-foreground) hover:bg-(--color-accent) hover:text-(--color-foreground)',
							'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'
						)}
					>
						<svg
							viewBox="0 0 20 20"
							class="h-3 w-3"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							aria-hidden="true"
						>
							<path d="M5 5l10 10M15 5l-10 10" />
						</svg>
					</button>
				</span>
			{/each}
			<div class="relative flex items-center">
				<input
					type="text"
					bind:value={stockInput}
					onkeydown={onStockKeydown}
					placeholder={stocks.length >= MAX_STOCKS ? `Max ${MAX_STOCKS}` : '+ ticker'}
					autocomplete="off"
					autocapitalize="characters"
					spellcheck="false"
					disabled={stocks.length >= MAX_STOCKS}
					aria-label="Add stock"
					title={stockInputError ?? 'Add stock'}
					class={cn(
						'h-7 w-28 rounded-full border px-2.5 text-xs font-medium uppercase transition-colors',
						'bg-(--color-card) text-(--color-card-foreground) placeholder:text-(--color-muted-foreground)',
						'border-dashed border-(--color-input) hover:border-(--color-muted-foreground)/60',
						'focus:border-(--color-ring) focus:outline-none',
						'disabled:cursor-not-allowed disabled:opacity-50',
						stockInputError && 'border-(--color-destructive)'
					)}
				/>
				{#if lookupStatus === 'loading'}
					<div
						class="absolute top-full left-2.5 mt-1 max-w-[16rem] truncate text-[11px] text-(--color-muted-foreground)"
					>
						Looking up…
					</div>
				{:else if lookupStatus === 'found' && lookupName}
					<div
						class="absolute top-full left-2.5 mt-1 max-w-[16rem] truncate text-[11px] text-(--color-muted-foreground)"
						title={lookupName}
					>
						{lookupName}
					</div>
				{:else if lookupStatus === 'notfound'}
					<div class="absolute top-full left-2.5 mt-1 text-[11px] text-(--color-destructive)">
						Not found
					</div>
				{/if}
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-1.5">
			{#each compares as c (c)}
				<span
					class="inline-flex h-7 items-center gap-1.5 rounded-full border pr-1 pl-2.5 text-xs font-medium tabular-nums"
					style="border-color: var(--color-border)"
				>
					<span
						class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
						style="background: {colorFor(c)}"
					></span>
					<span class="text-(--color-foreground)">{c}</span>
					<button
						type="button"
						aria-label={`Remove ${c}`}
						title={`Remove ${c}`}
						onclick={() => removeCompare(c)}
						class={cn(
							'inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors',
							'text-(--color-muted-foreground) hover:bg-(--color-accent) hover:text-(--color-foreground)'
						)}
					>
						<svg
							viewBox="0 0 20 20"
							class="h-3 w-3"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							aria-hidden="true"
						>
							<path d="M5 5l10 10M15 5l-10 10" />
						</svg>
					</button>
				</span>
			{/each}
			<CompareAddMenu
				excluded={compares}
				disabled={compares.length >= MAX_COMPARES}
				onAdd={addCompare}
			/>
		</div>

		<div class="ml-auto inline-flex items-center gap-2">
			<button
				type="button"
				title={shareCopied ? 'Link copied' : 'Copy shareable link'}
				aria-label="Copy shareable link"
				onclick={() => void share()}
				class={cn(
					'inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-medium',
					'bg-(--color-card) text-(--color-card-foreground) hover:bg-(--color-muted)',
					'border-(--color-input) transition-colors',
					'focus:border-(--color-ring) focus:outline-none'
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

			{#if pageData.supabase}
				<AccountMenu
					supabase={pageData.supabase}
					user={pageData.user}
					selection={{ stocks: [...stocks], compares: [...compares], range }}
					onLoad={applySelection}
				/>
			{/if}

			<OverflowMenu
				{loading}
				onRefresh={() => void load()}
				onReset={resetSelection}
				{theme}
				{themeOptions}
			/>
		</div>
	</header>

	<section class="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
		<div class="flex flex-wrap items-baseline gap-x-6 gap-y-2">
			{#if data}
				{#each data.series as s (s.symbol)}
					{@const cls = pctClass(s.summary.pctChange)}
					<div>
						<div class={cn('text-2xl font-semibold tracking-tight tabular-nums', cls)}>
							{formatPct(s.summary.pctChange, 1)}
						</div>
						<div class="mt-0.5 flex items-center gap-1.5 text-xs text-(--color-muted-foreground)">
							<span
								class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
								style="background: {colorFor(s.symbol)}"
							></span>
							<span>{s.symbol}</span>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<div class="ml-auto inline-flex items-center gap-1" role="radiogroup" aria-label="Time range">
			{#each RANGES as r (r)}
				<button
					type="button"
					role="radio"
					aria-checked={range === r}
					class={cn(
						'inline-flex h-7 items-center justify-center rounded-full px-3 text-xs font-medium tracking-wide transition-colors',
						range === r
							? 'bg-(--color-accent) text-(--color-foreground)'
							: 'text-(--color-muted-foreground) hover:bg-(--color-accent) hover:text-(--color-foreground)'
					)}
					onclick={(e) => {
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
								<span>Add a ticker to begin.</span>
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
