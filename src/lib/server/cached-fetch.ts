import { LRUCache } from './cache.js';
import type { FetchChart, YahooChartResult } from '../providers/yahoo.js';
import type { Interval } from '../providers/types.js';

// The cache is keyed without time bounds, so it is split by interval *class* and
// each class is capped independently — the count cap alone can't be sized for
// memory because intraday and daily entries differ ~10–100× in resident bytes.
//
// Intraday (1m/5m) entries are heavy: a 1m entry holds ~2.7k bars ≈ 0.4–0.7 MB.
// The cache is per *isolate* and shared across all concurrent clients on it, so
// the working set is NOT bounded by one request's 16 symbols — many clients can
// populate distinct intraday entries at once. A small dedicated cap bounds the
// worst case (~32 × 0.7 MB ≈ 22 MB) well inside a Workers isolate.
const INTRADAY_INTERVALS: ReadonlySet<Interval> = new Set(['1m', '5m']);
const INTRADAY_CACHE_MAX = 32;
// Daily-and-longer entries are cheap (~280 bars ≈ tens of KB), so a generous cap
// holds the full 16-symbol × 3-interval (1d/1wk/1mo) sweep without self-evicting.
const DAILY_CACHE_MAX = 96;
const RAW_CACHE_TTL_MS = 60_000;

// One interval of forward buffer on period2 so the in-progress final bar is
// always inside the fetched window. Membership here also marks which intervals
// are *cacheable*: only intervals we widen to a fixed canonical window have a
// time-bound-free key that is guaranteed to cover any later request. Intervals
// not produced by `intervalForRange` (15m/30m/1h) are absent → bypassed.
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

/**
 * The widened canonical opts for a cacheable interval, or `null` for an interval
 * we don't widen (15m/30m/1h). Returning `null` is the signal to **bypass** the
 * cache: without a fixed canonical window, the time-bound-free key can't promise
 * the stored raw covers a later request's `period1/period2` — a second valid
 * request could otherwise slice empty bars out of an unrelated window.
 */
function canonicalOpts(opts: ChartOpts): ChartOpts | null {
	const buffer = FORWARD_BUFFER_MS[opts.interval];
	if (buffer === undefined) return null; // not cacheable: no fixed window
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
	const intradayCache = new LRUCache<YahooChartResult>({
		max: INTRADAY_CACHE_MAX,
		ttlMs: RAW_CACHE_TTL_MS
	});
	const dailyCache = new LRUCache<YahooChartResult>({
		max: DAILY_CACHE_MAX,
		ttlMs: RAW_CACHE_TTL_MS
	});
	const inflight = new Map<string, Promise<YahooChartResult>>();

	return (symbol, opts) => {
		const canonical = canonicalOpts(opts);
		// Non-widened intervals (15m/30m/1h) have no fixed window the key can stand
		// in for, so bypass the cache *and* single-flight entirely and fetch the
		// caller's own bounds — sharing would risk slicing empty/unrelated bars.
		if (canonical === null) return inner(symbol, opts);

		const cache = INTRADAY_INTERVALS.has(opts.interval) ? intradayCache : dailyCache;
		const key = `${symbol}|${opts.interval}|${opts.includePrePost}`;

		const hit = cache.get(key);
		if (hit) return Promise.resolve(hit);

		const pending = inflight.get(key);
		if (pending) return pending;

		const p = inner(symbol, canonical)
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
