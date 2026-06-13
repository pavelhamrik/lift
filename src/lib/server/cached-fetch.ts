import { LRUCache } from './cache.js';
import type { FetchChart, YahooChartResult } from '../providers/yahoo.js';
import type { Interval } from '../providers/types.js';

// Sized to the endpoint's own working set: MAX_STOCKS(8) + MAX_COMPARES(8) = 16
// symbols × 5 intervals (1m/5m/1d/1wk/1mo) = 80 distinct keys worst-case, with
// headroom so a full 16-symbol sweep across every range never self-evicts inside
// the TTL. The short TTL keeps today's last bar fresh.
const RAW_CACHE_MAX = 96;
const RAW_CACHE_TTL_MS = 60_000;

// One interval of forward buffer on period2 so the in-progress final bar is
// always inside the fetched window. Intervals not produced by `intervalForRange`
// (15m/30m/1h) are absent → such requests pass through unwidened.
const FORWARD_BUFFER_MS: Partial<Record<Interval, number>> = {
	'1m': 60_000,
	'5m': 5 * 60_000,
	'1d': 24 * 60 * 60_000,
	'1wk': 7 * 24 * 60 * 60_000,
	'1mo': 30 * 24 * 60 * 60_000
};

type ChartOpts = Parameters<FetchChart>[1];

/**
 * The canonical `period1` for an interval: `period2 − (widest range that uses
 * the interval) − buffer`, anchored to the request's own `period2` (never
 * wall-clock — a fresh `Date.now()` computed a few ms late could land *after*
 * the caller's `period1` and silently drop its first bar). Because the span is
 * the widest range for the interval, every narrower range sharing it has
 * `period1 ≥ canonical.period1`, so one cached entry serves them all.
 */
function canonicalPeriod1(period2: Date, interval: Interval): Date {
	const d = new Date(period2.getTime());
	switch (interval) {
		case '1m':
			// Serves 1D (~2-day lookback). 7 days stays within Yahoo's 1m cap and
			// absorbs weekends so a 1D window always has session bars to slice.
			d.setUTCDate(d.getUTCDate() - 7);
			return d;
		case '5m':
			// Serves 5D (~9-day lookback) + buffer.
			d.setUTCDate(d.getUTCDate() - 35);
			return d;
		case '1d':
			// Serves 1M/6M/YTD/1Y. 13 months covers the widest (1Y, and a late-year
			// YTD) plus weekends/holidays — one fetch collapses all four ranges.
			d.setUTCMonth(d.getUTCMonth() - 13);
			return d;
		case '1wk':
			// Serves 5Y + ~1 month buffer.
			d.setUTCFullYear(d.getUTCFullYear() - 5);
			d.setUTCMonth(d.getUTCMonth() - 1);
			return d;
		case '1mo':
			// Serves MAX — epoch, matching benchmarks.ts (period1 = 0).
			return new Date(0);
		default:
			// 15m/30m/1h are never produced by intervalForRange; don't widen.
			return period2;
	}
}

function canonicalOpts(opts: ChartOpts): ChartOpts {
	const buffer = FORWARD_BUFFER_MS[opts.interval];
	if (buffer === undefined) return opts; // unsupported interval: pass through
	const period2 = new Date(opts.period2.getTime() + buffer);
	let period1 = canonicalPeriod1(period2, opts.interval);
	// Defensive: a caller reaching further back than the canonical window
	// (shouldn't happen given the range→interval map) is widened down to its own
	// period1 rather than truncated, so no requested bar is ever omitted.
	if (opts.period1.getTime() < period1.getTime()) period1 = opts.period1;
	return { ...opts, period1, period2 };
}

/**
 * Wraps a `FetchChart` with a per-`(symbol, interval, includePrePost)` raw-result
 * cache + single-flight, sitting **beneath** `makeYahooProvider` at the
 * `FetchChart` seam. The upstream fetch is widened to the canonical window for
 * the interval; `buildResultFromChart` re-slices each request back to its real
 * `period1/period2`, so the widening is invisible to callers and the
 * `PriceProvider` boundary, routes, and contract tests are all unchanged.
 *
 * `adjusted` is deliberately **not** in the key: the raw result carries both
 * `close` and `adjclose`, so one entry serves both bases. `includePrePost` (the
 * session) **is** in the key — Yahoo's raw response differs by it.
 */
export function withCachedFetch(inner: FetchChart): FetchChart {
	const cache = new LRUCache<YahooChartResult>({ max: RAW_CACHE_MAX, ttlMs: RAW_CACHE_TTL_MS });
	const inflight = new Map<string, Promise<YahooChartResult>>();

	return (symbol, opts) => {
		const key = `${symbol}|${opts.interval}|${opts.includePrePost}`;

		const hit = cache.get(key);
		if (hit) return Promise.resolve(hit);

		const pending = inflight.get(key);
		if (pending) return pending;

		const p = inner(symbol, canonicalOpts(opts))
			.then((raw) => {
				cache.set(key, raw);
				return raw;
			})
			.finally(() => {
				// Clear on settle (resolve *and* reject) so a failed fetch doesn't
				// poison the key — the next call retries instead of sharing the error.
				inflight.delete(key);
			});
		inflight.set(key, p);
		return p;
	};
}
