<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import {
		mountChart,
		readPalette,
		setPriceSeries,
		setVolumeSeries,
		type ChartHandles
	} from '$lib/chart/setup.js';
	import { pctChangeSeries } from '$lib/chart/normalize.js';
	import { createThemeStore, type ThemeMode } from '$lib/theme/mode.svelte.js';
	import { BENCHMARKS, DEFAULT_BENCHMARK } from '$lib/benchmarks.js';
	import { cn } from '$lib/utils.js';

	type ClosePoint = { time: number; close: number };
	type HistoryResponse = {
		aligned: { target: ClosePoint[]; benchmark: ClosePoint[] };
		targetVolume: { time: number; volume: number }[];
		meta: {
			target: { symbol: string; currency: string };
			benchmark: { symbol: string; currency: string };
			interval: '1m' | '5m' | '1d';
			session: 'regular' | 'extended';
			timezone: string;
			windowStart: number;
			windowEnd: number;
			returnBasis: 'price-only' | 'total-return';
		};
		summary: {
			target: { lastPrice: number; lastPriceTime: number; pctChange: number };
			benchmark: { lastPrice: number; lastPriceTime: number; pctChange: number };
		};
	};

	let symbolInput = $state('AAPL');
	let benchmark = $state<keyof typeof BENCHMARKS>(DEFAULT_BENCHMARK);
	let range = $state<'1D' | '1Y'>('1Y');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let data = $state<HistoryResponse | null>(null);

	const theme = createThemeStore();
	const themeOptions: ThemeMode[] = ['system', 'light', 'dark'];

	let chartEl: HTMLDivElement | undefined = $state();
	let handles: ChartHandles | null = null;

	function rangeLabel(r: '1D' | '1Y'): string {
		return r === '1D' ? '1D' : '1Y';
	}

	function basisLabel(r: 'price-only' | 'total-return'): string {
		return r === 'total-return' ? 'total return' : 'price-only';
	}

	const windowLabel = $derived.by(() => {
		if (!data) return '';
		return `${rangeLabel(range)} · ${data.meta.session} session · ${basisLabel(data.meta.returnBasis)}`;
	});

	const pctChangeColor = $derived.by(() => {
		if (!data) return 'text-(--color-fg)';
		const v = data.summary.target.pctChange;
		if (v > 0) return 'text-(--color-up)';
		if (v < 0) return 'text-(--color-down)';
		return 'text-(--color-fg)';
	});

	const benchPctColor = $derived.by(() => {
		if (!data) return 'text-(--color-muted-fg)';
		const v = data.summary.benchmark.pctChange;
		if (v > 0) return 'text-(--color-up)';
		if (v < 0) return 'text-(--color-down)';
		return 'text-(--color-muted-fg)';
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

	function formatPct(v: number): string {
		const sign = v > 0 ? '+' : '';
		return `${sign}${v.toFixed(2)}%`;
	}

	function formatLastTime(t: number, tz: string, interval: '1m' | '5m' | '1d'): string {
		const d = new Date(t * 1000);
		const opts: Intl.DateTimeFormatOptions =
			interval === '1d'
				? { year: 'numeric', month: 'short', day: '2-digit', timeZone: tz }
				: { hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false };
		try {
			return new Intl.DateTimeFormat('en-US', opts).format(d);
		} catch {
			return d.toISOString();
		}
	}

	async function load() {
		const sym = symbolInput.trim();
		if (!sym) {
			error = 'Enter a ticker symbol';
			return;
		}
		loading = true;
		error = null;
		try {
			const u = new URL('/api/history', window.location.origin);
			u.searchParams.set('symbol', sym);
			u.searchParams.set('benchmark', benchmark);
			u.searchParams.set('range', range);
			const r = await fetch(u);
			if (!r.ok) {
				const txt = await r.text();
				throw new Error(txt || `request failed (${r.status})`);
			}
			data = (await r.json()) as HistoryResponse;
			renderChart();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			data = null;
		} finally {
			loading = false;
		}
	}

	function renderChart() {
		if (!handles || !data) return;
		const tPct = pctChangeSeries(data.aligned.target);
		const bPct = pctChangeSeries(data.aligned.benchmark);
		setPriceSeries(handles, tPct, bPct);
		setVolumeSeries(handles, data.targetVolume);
	}

	onMount(() => {
		if (!chartEl) return;
		handles = mountChart(chartEl, readPalette());
		if (data) renderChart();
		void load();
	});

	$effect(() => {
		const _ = theme.resolved;
		if (handles && browser) handles.applyPalette(readPalette());
	});

	onDestroy(() => {
		handles?.dispose();
		theme.destroy();
	});

	function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		void load();
	}
</script>

<svelte:head>
	<title>stock-compare</title>
	<meta name="description" content="Compare a stock vs S&P 500 on price and volume" />
</svelte:head>

<div class="flex min-h-screen flex-col">
	<header
		class="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6"
		style="border-color: var(--color-border)"
	>
		<form onsubmit={onSubmit} class="flex items-center gap-2">
			<label for="symbol" class="sr-only">Ticker</label>
			<input
				id="symbol"
				type="text"
				bind:value={symbolInput}
				placeholder="Ticker (e.g. AAPL)"
				autocomplete="off"
				autocapitalize="characters"
				spellcheck="false"
				class={cn(
					'h-9 w-44 rounded-[var(--radius)] border px-3 text-sm uppercase outline-none',
					'transition-colors',
					'bg-(--color-card) text-(--color-card-fg) placeholder:text-(--color-muted-fg)',
					'focus:ring-2 focus:ring-(--color-ring)/40'
				)}
				style="border-color: var(--color-input)"
			/>

			<label for="benchmark" class="sr-only">Benchmark</label>
			<select
				id="benchmark"
				bind:value={benchmark}
				class={cn(
					'h-9 rounded-[var(--radius)] border bg-(--color-card) px-3 text-sm',
					'text-(--color-card-fg) focus:ring-2 focus:ring-(--color-ring)/40 focus:outline-none'
				)}
				style="border-color: var(--color-input)"
			>
				{#each Object.entries(BENCHMARKS) as [key, entry] (key)}
					<option value={key}>{entry.label}</option>
				{/each}
			</select>

			<div
				class="inline-flex h-9 overflow-hidden rounded-[var(--radius)] border"
				style="border-color: var(--color-input)"
			>
				{#each ['1D', '1Y'] as r (r)}
					<button
						type="button"
						class={cn(
							'px-3 text-sm transition-colors',
							range === r
								? 'bg-(--color-accent) text-(--color-accent-fg)'
								: 'bg-(--color-card) text-(--color-card-fg) hover:bg-(--color-muted)'
						)}
						onclick={() => {
							range = r as '1D' | '1Y';
							void load();
						}}
					>
						{r}
					</button>
				{/each}
			</div>

			<button
				type="submit"
				class={cn(
					'inline-flex h-9 items-center justify-center rounded-[var(--radius)] border px-3 text-sm',
					'bg-(--color-card) text-(--color-card-fg) hover:bg-(--color-muted)',
					'disabled:opacity-50'
				)}
				disabled={loading}
				style="border-color: var(--color-input)"
			>
				{loading ? 'Loading…' : 'Refresh'}
			</button>
		</form>

		<div class="ml-auto inline-flex h-9 overflow-hidden rounded-[var(--radius)] border" style="border-color: var(--color-input)">
			{#each themeOptions as m (m)}
				<button
					type="button"
					class={cn(
						'px-3 text-sm capitalize transition-colors',
						theme.mode === m
							? 'bg-(--color-accent) text-(--color-accent-fg)'
							: 'bg-(--color-card) text-(--color-card-fg) hover:bg-(--color-muted)'
					)}
					onclick={() => theme.setMode(m)}
				>
					{m}
				</button>
			{/each}
		</div>
	</header>

	<section class="px-4 py-4 sm:px-6">
		{#if error}
			<div
				class="rounded-[var(--radius)] border px-4 py-3 text-sm"
				style="border-color: var(--color-down); color: var(--color-down); background: color-mix(in srgb, var(--color-down) 8%, transparent)"
			>
				{error}
			</div>
		{:else if !data}
			<div class="text-sm text-(--color-muted-fg)">
				{loading ? 'Loading…' : 'Enter a ticker to begin.'}
			</div>
		{:else}
			<div class="flex flex-wrap items-baseline gap-x-6 gap-y-2">
				<div>
					<div class="text-2xl font-semibold tracking-tight">{data.meta.target.symbol}</div>
					<div class="mt-0.5 text-xs text-(--color-muted-fg)">
						{formatPrice(data.summary.target.lastPrice, data.meta.target.currency)} · as of
						{formatLastTime(data.summary.target.lastPriceTime, data.meta.timezone, data.meta.interval)}
					</div>
				</div>

				<div>
					<div class={cn('text-2xl font-semibold tracking-tight', pctChangeColor)}>
						{formatPct(data.summary.target.pctChange)}
					</div>
					<div class="mt-0.5 text-xs text-(--color-muted-fg)">{data.meta.target.symbol} (window)</div>
				</div>

				<div>
					<div class={cn('text-2xl font-semibold tracking-tight', benchPctColor)}>
						{formatPct(data.summary.benchmark.pctChange)}
					</div>
					<div class="mt-0.5 text-xs text-(--color-muted-fg)">
						{data.meta.benchmark.symbol} (window)
					</div>
				</div>

				<div class="ml-auto text-right">
					<div class="text-xs text-(--color-muted-fg)">{windowLabel}</div>
				</div>
			</div>
		{/if}
	</section>

	<section class="relative flex-1 px-4 pb-2 sm:px-6">
		<div
			bind:this={chartEl}
			class="h-full min-h-[420px] w-full rounded-[var(--radius)] border bg-(--color-card)"
			style="border-color: var(--color-border)"
		></div>
	</section>

	<footer class="px-4 pb-4 text-right text-[11px] text-(--color-muted-fg) sm:px-6">
		Charts by
		<a
			href="https://www.tradingview.com/"
			target="_blank"
			rel="noopener noreferrer"
			class="underline hover:text-(--color-fg)">TradingView</a
		>
	</footer>
</div>
