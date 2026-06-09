<script lang="ts">
	import { cn } from '$lib/utils.js';
</script>

<svelte:head>
	<title>Docs · Stock Compare</title>
	<meta name="description" content="What Stock Compare does, its limitations, and where the data comes from." />
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
	<header class="mb-10 flex items-center justify-between">
		<h1 class="text-2xl font-semibold tracking-tight">Docs</h1>
		<a
			href="/"
			class={cn(
				'inline-flex h-9 items-center justify-center rounded-full border px-4 text-sm font-medium',
				'bg-(--color-card) text-(--color-card-foreground) hover:bg-(--color-muted)',
				'border-(--color-input) transition-colors',
				'focus:border-(--color-ring) focus:outline-none'
			)}
		>
			← Back
		</a>
	</header>

	<section class="mb-10">
		<h2 class="mb-3 text-lg font-semibold tracking-tight">What this does</h2>
		<div class="space-y-3 text-sm leading-relaxed text-(--color-foreground)">
			<p>
				Stock Compare plots one or more stocks against one or more benchmark indices on a single
				chart. All series are normalised to percent change from the start of the selected time
				window so they share a common y-axis regardless of price level or currency.
			</p>
			<p>
				A volume histogram tracks the primary (first) stock on the same time axis. Switch the time
				range from intraday (1D, 5D) up to MAX with the range pills.
			</p>
		</div>
	</section>

	<section class="mb-10">
		<h2 class="mb-3 text-lg font-semibold tracking-tight">How to use it</h2>
		<div class="space-y-3 text-sm leading-relaxed text-(--color-foreground)">
			<p>
				Type a ticker into the dashed pill and press Enter to add it as a stock series. Up to eight
				stocks at a time. Click the × on a chip to remove it.
			</p>
			<p>
				Add comparison indices via the <strong>+ Compare</strong> dropdown — these are pulled from a
				curated list of US, European, global, and APAC benchmarks. Up to eight at a time.
			</p>
			<p>
				The <strong>Reset</strong> button restores the default selection (AAPL + S&amp;P 500 ETF).
				<strong>Refresh</strong> re-fetches the current selection.
			</p>
		</div>
	</section>

	<section class="mb-10">
		<h2 class="mb-3 text-lg font-semibold tracking-tight">Caveats &amp; limitations</h2>
		<div class="space-y-3 text-sm leading-relaxed text-(--color-foreground)">
			<p>
				<strong>Trading-calendar gaps.</strong> When you combine stocks listed on different
				exchanges (e.g. AAPL on Nasdaq and ADS.DE on Xetra), the chart only shows days where
				<em>every</em>
				selected series traded. Holidays that fall on one exchange but not another will be skipped from
				all series, including the survivors.
			</p>
			<p>
				<strong>Daily bars only align to local exchange calendars.</strong> For intervals of one day
				or longer, each bar is bucketed by the exchange's local calendar date. Cross-market mixing
				therefore relies on those calendar dates lining up — usually they do, but the holiday point
				above is the consequence when they don't.
			</p>
			<p>
				<strong>Return basis can be mixed.</strong> ETF benchmarks (SPY, QQQ, IWM, URTH, EEM, ACWI)
				are dividend-adjusted total return. Index benchmarks (^GSPC, ^IXIC, ^FTSE, etc.) are
				price-only. Stocks are dividend-adjusted whenever at least one selected benchmark is
				total-return; otherwise they are price-only. This keeps each stock on the same basis as its
				comparison set, but the basis is not uniform if you mix policies.
			</p>
			<p>
				<strong>Intraday ranges are price-only.</strong> 1D and 5D ranges always use raw price
				(no dividend adjustment) regardless of the benchmark policy.
			</p>
			<p>
				<strong>Currency is not converted.</strong> Comparisons hold up across currencies because
				everything is shown in % change, but the per-stock "last price" shown above the chart is in
				the security's native currency.
			</p>
			<p>
				<strong>No after-hours.</strong> Pre-market and after-hours sessions are excluded.
			</p>
			<p>
				<strong>Data freshness.</strong> Responses are cached for up to 60 seconds at the edge,
				so the latest bar may lag the live market by that amount.
			</p>
			<p>
				<strong>Provider quirks.</strong> Symbol coverage and historical depth depend on what
				Yahoo Finance returns. Some exotic tickers, recent IPOs, or delisted symbols may have
				partial or missing data.
			</p>
		</div>
	</section>

	<section class="mb-10">
		<h2 class="mb-3 text-lg font-semibold tracking-tight">Data source</h2>
		<div class="space-y-3 text-sm leading-relaxed text-(--color-foreground)">
			<p>
				All price and volume data comes from
				<a
					href="https://finance.yahoo.com/"
					target="_blank"
					rel="noreferrer noopener"
					class="underline underline-offset-2 hover:text-(--color-primary)"
				>
					Yahoo Finance
				</a>
				via the
				<a
					href="https://github.com/gadicc/node-yahoo-finance2"
					target="_blank"
					rel="noreferrer noopener"
					class="underline underline-offset-2 hover:text-(--color-primary)"
				>
					yahoo-finance2
				</a>
				client. Ticker name lookups use Yahoo's quote endpoint. Yahoo data is unofficial and provided
				without uptime or accuracy guarantees; please don't use this tool for investment decisions.
			</p>
			<p>
				Charts are drawn with
				<a
					href="https://tradingview.github.io/lightweight-charts/"
					target="_blank"
					rel="noreferrer noopener"
					class="underline underline-offset-2 hover:text-(--color-primary)"
				>
					TradingView Lightweight Charts
				</a>
				(Apache 2.0).
			</p>
		</div>
	</section>
</div>
