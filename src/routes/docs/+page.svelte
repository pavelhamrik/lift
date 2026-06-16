<script lang="ts">
	import { resolve } from '$app/paths';
	import { cn } from '$lib/utils.js';
	import Logo from '$lib/components/ui/Logo.svelte';
</script>

<svelte:head>
	<title>Docs · Lift</title>
	<meta
		name="description"
		content="What Lift does, its limitations, and where the data comes from."
	/>
</svelte:head>

<header class="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
	<a href="/" aria-label="Lift home" class="mr-1 inline-flex shrink-0 items-center">
		<Logo class="h-5 w-auto text-(--color-foreground)" />
	</a>
	<a
		href="/"
		class={cn(
			'ml-auto inline-flex h-9 items-center justify-center rounded-full border px-4 text-sm font-medium',
			'bg-(--color-card) text-(--color-card-foreground) hover:bg-(--color-muted)',
			'border-(--color-input) transition-[color,box-shadow]',
			'focus-ring'
		)}
	>
		Go to App
	</a>
</header>

<div class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
	<h1 class="mb-10 text-3xl font-semibold tracking-tight">Docs</h1>

	<section class="mb-10">
		<h2 class="mb-3 text-xl font-semibold tracking-tight">What this does</h2>
		<div class="space-y-3 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
			<p>
				Lift plots one or more stocks against one or more benchmark indices on a single chart. All
				series are normalised to percent change from the start of the selected time window so they
				share a common y-axis regardless of price level or currency.
			</p>
			<p>
				A volume histogram tracks the primary (first) stock on the same time axis. Switch the time
				range from intraday (1D, 5D) up to MAX with the range pills.
			</p>
		</div>
	</section>

	<section class="mb-10">
		<h2 class="mb-3 text-xl font-semibold tracking-tight">How to use it</h2>
		<div class="space-y-3 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
			<p>
				Type a ticker or index name into the search box at the top and pick a result — or press
				Enter to add the highlighted match. Up to <strong>16 series</strong> at a time. Focus the
				empty box to browse popular tickers and the curated indices (US, European, global, and
				APAC). To add a symbol that isn't in the list, type it exactly and press
				<strong>⌘/Ctrl + Enter</strong>.
			</p>
			<p>
				Each added series appears in the list below the search box with its color, symbol, and
				<strong>% change</strong> for the selected range. Click the × on a row to remove it (at least
				one series always stays).
			</p>
			<p>
				Classification is automatic: a Yahoo <em>index</em> renders as a gray dashed line; everything
				else — stocks and ETFs — renders as a colored solid line. You no longer pre-classify a symbol
				before adding it.
			</p>
			<p>
				The <strong>⋯</strong> menu (top right) holds <strong>Reset to defaults</strong> — which
				restores the default selection (AAPL + S&amp;P 500 ETF) — the <strong>Return basis</strong>
				toggle (see below), a link to these docs, and the light/dark theme toggle. The chart re-fetches
				your selection automatically about once a minute while the tab is open, so there's no manual refresh.
			</p>
		</div>
	</section>

	<section class="mb-10">
		<h2 class="mb-3 text-xl font-semibold tracking-tight">Caveats &amp; limitations</h2>
		<div class="space-y-3 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
			<p>
				<strong>Trading-calendar gaps are carried forward, not dropped.</strong> When you combine
				series listed on different exchanges (e.g. AAPL on Nasdaq and a Tokyo index), days or
				sessions where one series didn't trade are no longer dropped from everything. Instead each
				series is
				<em>carried forward</em> (its last value held) across the timestamps it's missing — shown as a
				flat segment — and every series is rebased to a common baseline so the comparison stays apples-to-apples.
				A flat segment beats a blank chart.
			</p>
			<p>
				<strong>Return basis is a single toggle.</strong> The <strong>Return basis</strong> control
				in the ⋯ menu switches every series between <em>price-only</em> and dividend-adjusted
				<em>total return</em> at once — it's uniform across your whole selection and your choice, not
				inferred per symbol. It's shared in the link and saved with your view. The default is total return.
			</p>
			<p>
				<strong>Intraday ranges are price-only.</strong> 1D and 5D ranges always use raw price (no dividend
				adjustment) regardless of the toggle, which is disabled on those ranges.
			</p>
			<p>
				<strong>Currency is not converted.</strong> Comparisons hold up across currencies because everything
				is shown in % change, but the per-stock "last price" shown above the chart is in the security's
				native currency.
			</p>
			<p>
				<strong>No after-hours.</strong> Pre-market and after-hours sessions are excluded.
			</p>
			<p>
				<strong>Data freshness.</strong> Responses are cached for up to 60 seconds at the edge, so the
				latest bar may lag the live market by that amount.
			</p>
			<p>
				<strong>Provider quirks.</strong> Symbol coverage and historical depth depend on what Yahoo Finance
				returns. Some exotic tickers, recent IPOs, or delisted symbols may have partial or missing data.
			</p>
		</div>
	</section>

	<section class="mb-10">
		<h2 class="mb-3 text-xl font-semibold tracking-tight">Data source</h2>
		<div class="space-y-3 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
			<p>
				All price and volume data comes directly from
				<a
					href="https://finance.yahoo.com/"
					target="_blank"
					rel="noreferrer noopener"
					class="text-(--color-foreground) underline underline-offset-2 hover:text-(--color-primary)"
				>
					Yahoo Finance
				</a>
				— its public chart API for prices, and its symbol-lookup endpoint for ticker search and names.
				Yahoo data is unofficial and provided without uptime or accuracy guarantees; please don't use
				this tool for investment decisions.
			</p>
			<p>
				Charts are drawn with
				<a
					href="https://tradingview.github.io/lightweight-charts/"
					target="_blank"
					rel="noreferrer noopener"
					class="text-(--color-foreground) underline underline-offset-2 hover:text-(--color-primary)"
				>
					TradingView Lightweight Charts
				</a>
				(Apache 2.0).
			</p>
		</div>
	</section>

	<footer class="flex gap-4 border-t pt-6 text-sm text-(--color-muted-foreground)">
		<a href={resolve('/terms')} class="underline underline-offset-2 hover:text-(--color-foreground)"
			>Terms</a
		>
		<a
			href={resolve('/privacy')}
			class="underline underline-offset-2 hover:text-(--color-foreground)"
		>
			Privacy
		</a>
	</footer>
</div>

<style>
	/* Bold lead-ins: semibold weight, full-contrast foreground. */
	strong {
		font-weight: 600;
		color: var(--color-foreground);
	}
</style>
