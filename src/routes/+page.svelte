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
	import { RANGES, type Range } from '$lib/providers/types.js';
	import { cn } from '$lib/utils.js';
	import {
		parseSelection,
		parseSelectionParams,
		selectionToSearchParams,
		serializeSelection,
		SELECTION_STORAGE_KEY
	} from '$lib/selection.js';

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
	let error = $state<string | null>(null);
	let data = $state<MultiResponse | null>(null);
	let shareCopied = $state(false);
	let shareTimer: ReturnType<typeof setTimeout> | null = null;

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
		const tipCount = tooltip.values.length + (tooltip.volume !== undefined && tooltip.volume > 0 ? 1 : 0);
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

	async function load() {
		if (stocks.length === 0) {
			error = 'Add at least one stock';
			return;
		}
		loading = true;
		error = null;
		try {
			const u = new URL('/api/history-multi', window.location.origin);
			u.searchParams.set('stocks', stocks.join(','));
			u.searchParams.set('compares', compares.join(','));
			u.searchParams.set('range', range);
			const r = await fetch(u);
			if (!r.ok) {
				const txt = await r.text();
				throw new Error(txt || `request failed (${r.status})`);
			}
			data = (await r.json()) as MultiResponse;
			renderChart();
			persistSelection();
			syncUrl();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			data = null;
		} finally {
			loading = false;
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
			const stored = fromUrl ?? parseSelection(localStorage.getItem(SELECTION_STORAGE_KEY));
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
		if (shareTimer) clearTimeout(shareTimer);
	});

	const primarySeries = $derived.by(() => data?.series.find((s) => s.kind === 'stock'));
</script>

<svelte:head>
	<title>Stock Compare</title>
	<meta name="description" content="Compare stocks vs benchmarks on normalized return + volume" />
</svelte:head>

<div class="flex min-h-screen flex-col">
	<header class="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
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
							'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'
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
						'disabled:opacity-50 disabled:cursor-not-allowed',
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
					<div
						class="absolute top-full left-2.5 mt-1 text-[11px] text-(--color-destructive)"
					>
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
						<circle cx="18" cy="5" r="3" />
						<circle cx="6" cy="12" r="3" />
						<circle cx="18" cy="19" r="3" />
						<path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
					</svg>
					Share
				{/if}
			</button>

			<button
				type="button"
				title="Reset to defaults"
				onclick={resetSelection}
				class={cn(
					'inline-flex h-9 items-center justify-center rounded-full border px-4 text-sm font-medium',
					'bg-(--color-card) text-(--color-card-foreground) hover:bg-(--color-muted)',
					'border-(--color-input) transition-colors',
					'focus:border-(--color-ring) focus:outline-none'
				)}
			>
				Reset
			</button>

			<button
				type="button"
				aria-label={loading ? 'Loading' : 'Refresh'}
				title={loading ? 'Loading…' : 'Refresh'}
				onclick={() => void load()}
				class={cn(
					'inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm',
					'bg-(--color-card) text-(--color-card-foreground) hover:bg-(--color-muted)',
					'border-(--color-input) disabled:opacity-50 transition-colors',
					'focus:border-(--color-ring) focus:outline-none'
				)}
				disabled={loading}
			>
				<svg
					viewBox="0 0 24 24"
					class={cn('h-4 w-4', loading && 'animate-spin')}
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M21 12a9 9 0 1 1-3.51-7.13" />
					<path d="M21 4v5h-5" />
				</svg>
			</button>

			<a
				href="/docs"
				aria-label="Docs"
				title="Docs"
				class={cn(
					'ml-2 inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm',
					'bg-(--color-card) text-(--color-card-foreground) hover:bg-(--color-muted)',
					'border-(--color-input) transition-colors',
					'focus:border-(--color-ring) focus:outline-none'
				)}
			>
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
					<circle cx="12" cy="12" r="9" />
					<path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5" />
					<circle cx="12" cy="17" r="0.6" fill="currentColor" />
				</svg>
			</a>

			<div
				class="inline-flex items-center gap-0.5 rounded-full border p-0.5"
				style="border-color: var(--color-border)"
				role="radiogroup"
				aria-label="Theme"
			>
				{#each themeOptions as m (m)}
					<button
						type="button"
						role="radio"
						aria-checked={theme.mode === m}
						aria-label={m}
						title={m}
						class={cn(
							'inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors',
							theme.mode === m
								? 'bg-(--color-accent) text-(--color-foreground)'
								: 'text-(--color-muted-foreground) hover:bg-(--color-accent) hover:text-(--color-foreground)'
						)}
						onclick={(e) => {
							theme.setMode(m);
							(e.currentTarget as HTMLButtonElement).blur();
						}}
					>
						{#if m === 'system'}
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
								<rect x="3" y="4" width="18" height="12" rx="2" />
								<path d="M8 20h8M12 16v4" />
							</svg>
						{:else if m === 'light'}
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
								<circle cx="12" cy="12" r="4" />
								<path
									d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
								/>
							</svg>
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
								<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
							</svg>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</header>

	<section class="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
		<div class="flex flex-wrap items-baseline gap-x-6 gap-y-2">
			{#if error}
				<div
					class="rounded-[var(--radius)] border px-4 py-3 text-sm"
					style="border-color: var(--color-destructive); color: var(--color-destructive); background: color-mix(in srgb, var(--color-destructive) 8%, transparent)"
				>
					{error}
				</div>
			{:else if !data}
				<div class="text-sm text-(--color-muted-foreground)">
					{loading ? 'Loading…' : 'Add a ticker to begin.'}
				</div>
			{:else}
				{#each data.series as s (s.symbol)}
					{@const cls = pctClass(s.summary.pctChange)}
					<div>
						<div class={cn('text-2xl font-semibold tracking-tight tabular-nums', cls)}>
							{formatPct(s.summary.pctChange, 1)}
						</div>
						<div
							class="mt-0.5 flex items-center gap-1.5 text-xs text-(--color-muted-foreground)"
						>
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

		<div
			class="ml-auto inline-flex items-center gap-1"
			role="radiogroup"
			aria-label="Time range"
		>
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
								<span class={cn('tabular-nums font-medium', pctClass(v.value))}>
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
								<span class="tabular-nums text-(--color-foreground)">
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
