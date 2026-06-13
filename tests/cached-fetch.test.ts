import { describe, it, expect, vi, afterEach } from 'vitest';
import { withCachedFetch } from '../src/lib/server/cached-fetch.js';
import {
	makeYahooProvider,
	type FetchChart,
	type YahooChartMeta,
	type YahooChartResult
} from '../src/lib/providers/yahoo.js';
import type { HistoryRequest, Interval } from '../src/lib/providers/types.js';

type ChartOpts = Parameters<FetchChart>[1];

const DAY = 86_400_000;
const SEC = (ms: number) => Math.floor(ms / 1000);

const STEP_MS: Record<Interval, number> = {
	'1m': 60_000,
	'5m': 300_000,
	'15m': 900_000,
	'30m': 1_800_000,
	'1h': 3_600_000,
	'1d': DAY,
	'1wk': 7 * DAY,
	'1mo': 30 * DAY
};

function meta(symbol: string): YahooChartMeta {
	return {
		symbol,
		currency: 'USD',
		exchangeName: 'NMS',
		instrumentType: 'EQUITY',
		exchangeTimezoneName: 'America/New_York',
		regularMarketPrice: 100
	};
}

// Lightweight raw for count-only tests — value doesn't matter, only call counts.
function tinyRaw(symbol: string): YahooChartResult {
	return {
		meta: meta(symbol),
		quotes: [{ date: new Date(0), close: 1, adjclose: 0.9, volume: 0 }]
	};
}

// Daily/weekly/monthly bars anchored to noon UTC so calendar-date normalization
// in buildResultFromChart is stable; `adjclose = close * 0.9` so adjusted and
// unadjusted curves are distinguishable.
function barsFor(symbol: string, opts: ChartOpts): YahooChartResult {
	const step = STEP_MS[opts.interval] ?? DAY;
	const quotes: YahooChartResult['quotes'] = [];
	let t = Math.floor(opts.period1.getTime() / DAY) * DAY + DAY / 2; // noon of period1's day
	while (t < opts.period1.getTime()) t += step;
	for (; t <= opts.period2.getTime(); t += step) {
		const dayIdx = Math.floor(t / DAY);
		const close = 100 + (dayIdx % 50);
		quotes.push({ date: new Date(t), close, adjclose: close * 0.9, volume: 1000 });
	}
	return { meta: meta(symbol), quotes };
}

type SpyImpl = (symbol: string, opts: ChartOpts, callIndex: number) => Promise<YahooChartResult>;

function makeSpy(impl?: SpyImpl) {
	const calls: Array<{ symbol: string; opts: ChartOpts }> = [];
	const fetch: FetchChart = (symbol, opts) => {
		const idx = calls.length;
		calls.push({ symbol, opts });
		return (impl ?? ((s) => Promise.resolve(tinyRaw(s))))(symbol, opts, idx);
	};
	return { fetch, calls };
}

const opts1d = (over?: Partial<ChartOpts>): ChartOpts => ({
	interval: '1d',
	includePrePost: false,
	period1: new Date(Date.UTC(2024, 0, 1)),
	period2: new Date(Date.UTC(2024, 2, 1)),
	...over
});

describe('withCachedFetch — caching & single-flight', () => {
	it('serves different sub-ranges of one (symbol, interval, session) from a single fetch', async () => {
		const { fetch, calls } = makeSpy();
		const cached = withCachedFetch(fetch);

		const wide = await cached('AAPL', opts1d({ period1: new Date(Date.UTC(2024, 0, 1)) }));
		const narrow = await cached(
			'AAPL',
			opts1d({ period1: new Date(Date.UTC(2024, 1, 1)), period2: new Date(Date.UTC(2024, 1, 20)) })
		);

		expect(calls.length).toBe(1); // period1/period2 are NOT in the key
		expect(narrow).toBe(wide); // both get the same cached raw
	});

	it('fetches the widened canonical window anchored to opts.period2, not wall-clock', async () => {
		const { fetch, calls } = makeSpy();
		const cached = withCachedFetch(fetch);

		// A fixed, long-past period2: if the window anchored to Date.now() instead,
		// the canonical period2 would be ~now (2025/2026), not this 2024 date.
		const period2 = new Date(Date.UTC(2024, 0, 15));
		await cached('AAPL', {
			interval: '1d',
			includePrePost: false,
			period1: new Date(Date.UTC(2024, 0, 10)),
			period2
		});

		expect(calls.length).toBe(1);
		const c = calls[0].opts;
		// period2 = request's own period2 + one-interval (1 day) forward buffer.
		expect(c.period2.getTime()).toBe(period2.getTime() + DAY);
		// period1 widened to ~13 months before the canonical period2.
		expect(c.period1.getTime()).toBeLessThan(Date.UTC(2024, 0, 10));
		const spanDays = (c.period2.getTime() - c.period1.getTime()) / DAY;
		expect(spanDays).toBeGreaterThan(365);
		expect(spanDays).toBeLessThan(420);
	});

	it('keys on session (includePrePost) — regular vs extended fetch separately', async () => {
		const { fetch, calls } = makeSpy();
		const cached = withCachedFetch(fetch);

		await cached('AAPL', opts1d({ includePrePost: false }));
		await cached('AAPL', opts1d({ includePrePost: true }));

		expect(calls.length).toBe(2);
	});

	it('single-flights concurrent calls for one key into one upstream fetch', async () => {
		let resolveInner: (v: YahooChartResult) => void = () => {};
		const { fetch, calls } = makeSpy(() => new Promise((res) => (resolveInner = res)));
		const cached = withCachedFetch(fetch);

		const p1 = cached('AAPL', opts1d());
		const p2 = cached('AAPL', opts1d());
		expect(calls.length).toBe(1); // second call shares the in-flight promise

		const raw = tinyRaw('AAPL');
		resolveInner(raw);
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1).toBe(raw);
		expect(r2).toBe(raw);
	});

	it('clears the key on rejection so the next call retries (no poisoned entry)', async () => {
		const { fetch, calls } = makeSpy((s, o, i) =>
			i === 0 ? Promise.reject(new Error('boom')) : Promise.resolve(tinyRaw(s))
		);
		const cached = withCachedFetch(fetch);

		await expect(cached('AAPL', opts1d())).rejects.toThrow('boom');
		const r = await cached('AAPL', opts1d());
		expect(calls.length).toBe(2); // retried rather than replaying the failure
		expect(r.quotes.length).toBeGreaterThan(0);
	});

	it('refetches after the TTL expires', async () => {
		vi.useFakeTimers();
		try {
			const { fetch, calls } = makeSpy();
			const cached = withCachedFetch(fetch);

			await cached('AAPL', opts1d());
			await cached('AAPL', opts1d());
			expect(calls.length).toBe(1); // warm cache

			vi.advanceTimersByTime(60_001);
			await cached('AAPL', opts1d());
			expect(calls.length).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('evicts the oldest daily key past the daily capacity bound', async () => {
		const { fetch, calls } = makeSpy();
		const cached = withCachedFetch(fetch);

		// Daily cap is 96; 97 distinct keys evicts the first (S0).
		for (let i = 0; i < 97; i++) await cached(`S${i}`, opts1d());
		expect(calls.length).toBe(97);

		await cached('S0', opts1d()); // evicted → refetch
		expect(calls.length).toBe(98);
		expect(calls.filter((c) => c.symbol === 'S0').length).toBe(2);
	});

	it('caps intraday entries separately (heavy 1m/5m bounded below the daily cap)', async () => {
		const { fetch, calls } = makeSpy();
		const cached = withCachedFetch(fetch);
		const opts1m = (sym: number): [string, ChartOpts] => [`S${sym}`, opts1d({ interval: '1m' })];

		// Intraday cap is 32; 33 distinct 1m keys evicts the first (S0)...
		for (let i = 0; i < 33; i++) await cached(...opts1m(i));
		await cached(...opts1m(0)); // evicted → refetch
		expect(calls.filter((c) => c.symbol === 'S0').length).toBe(2);

		// ...while a daily key populated long before is still warm (separate cap).
		const before = calls.length;
		await cached('DAILY', opts1d());
		await cached('DAILY', opts1d());
		expect(calls.length).toBe(before + 1); // second is a hit
	});

	it('bypasses the cache for non-widened intervals (no empty-bar cross-contamination)', async () => {
		const { fetch, calls } = makeSpy();
		const cached = withCachedFetch(fetch);
		const win = (m: number): ChartOpts => ({
			interval: '1h',
			includePrePost: false,
			period1: new Date(Date.UTC(2024, m, 1)),
			period2: new Date(Date.UTC(2024, m + 1, 1))
		});

		await cached('AAPL', win(0)); // Jan–Feb
		await cached('AAPL', win(2)); // Mar–Apr (disjoint, same key shape)

		expect(calls.length).toBe(2); // not shared
		// Each fetch keeps the caller's OWN bounds — never widened, never reused.
		expect(calls[0].opts.period1.getTime()).toBe(Date.UTC(2024, 0, 1));
		expect(calls[1].opts.period1.getTime()).toBe(Date.UTC(2024, 2, 1));
	});
});

describe('withCachedFetch — through makeYahooProvider', () => {
	const req = (over: Partial<HistoryRequest>): HistoryRequest => ({
		interval: '1d',
		session: 'regular',
		adjusted: false,
		period1: SEC(Date.UTC(2024, 5, 1)),
		period2: SEC(Date.UTC(2025, 5, 1)),
		...over
	});

	it('slices a 1Y request from the widened window with no first-bar omission', async () => {
		const { fetch, calls } = makeSpy((s, o) => Promise.resolve(barsFor(s, o)));
		const provider = makeYahooProvider(withCachedFetch(fetch));

		const r = req({ period1: SEC(Date.UTC(2024, 5, 1)), period2: SEC(Date.UTC(2025, 5, 1)) });
		const { result } = await provider.getHistory('AAPL', r);

		expect(calls.length).toBe(1);
		expect(result.bars.length).toBeGreaterThan(0);
		// First retained bar lands at (not after) the start of the requested window.
		expect(result.bars[0].time).toBeGreaterThanOrEqual(r.period1);
		expect(result.bars[0].time).toBeLessThanOrEqual(r.period1 + 2 * 86400);
		// Last retained bar is inside the requested window.
		expect(result.bars.at(-1)!.time).toBeLessThanOrEqual(r.period2);
		expect(result.bars.at(-1)!.time).toBeGreaterThanOrEqual(r.period2 - 4 * 86400);
	});

	it('slices a 5Y/1wk request from its widened window with no first-bar omission', async () => {
		const { fetch, calls } = makeSpy((s, o) => Promise.resolve(barsFor(s, o)));
		const provider = makeYahooProvider(withCachedFetch(fetch));

		const r = req({
			interval: '1wk',
			period1: SEC(Date.UTC(2020, 5, 1)),
			period2: SEC(Date.UTC(2025, 5, 1))
		});
		const { result } = await provider.getHistory('AAPL', r);

		expect(calls.length).toBe(1);
		expect(result.bars.length).toBeGreaterThan(0);
		expect(result.bars[0].time).toBeGreaterThanOrEqual(r.period1);
		expect(result.bars[0].time).toBeLessThanOrEqual(r.period1 + 9 * 86400);
	});

	it('serves adjusted and unadjusted from one cached entry', async () => {
		const { fetch, calls } = makeSpy((s, o) => Promise.resolve(barsFor(s, o)));
		const provider = makeYahooProvider(withCachedFetch(fetch));

		const base = req({ period1: SEC(Date.UTC(2024, 0, 1)), period2: SEC(Date.UTC(2024, 3, 1)) });
		const adj = await provider.getHistory('AAPL', { ...base, adjusted: true });
		const raw = await provider.getHistory('AAPL', { ...base, adjusted: false });

		expect(calls.length).toBe(1); // `adjusted` is NOT in the key
		const a0 = adj.result.bars[0];
		const r0 = raw.result.bars[0];
		expect(a0.time).toBe(r0.time);
		expect(a0.close).toBeCloseTo(r0.close * 0.9, 5); // adjusted uses adjclose
	});
});

describe('getProvider() wiring', () => {
	const ORIGINAL = process.env.STOCK_FIXTURES;
	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.STOCK_FIXTURES;
		else process.env.STOCK_FIXTURES = ORIGINAL;
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it('wraps the chart fetcher with withCachedFetch (one upstream fetch for overlapping ranges)', async () => {
		process.env.STOCK_FIXTURES = '1';
		vi.resetModules();
		const fixturesMod = await import('../src/lib/providers/fixtures.js');
		const spy = vi.spyOn(fixturesMod, 'fixtureFetch');
		const { getProvider } = await import('../src/lib/providers/index.js');

		const provider = getProvider();
		expect(getProvider()).toBe(provider); // singleton

		const p2 = SEC(Date.UTC(2025, 5, 1));
		const base = {
			interval: '1d' as const,
			session: 'regular' as const,
			adjusted: false,
			period2: p2
		};
		await provider.getHistory('AAPL', { ...base, period1: SEC(Date.UTC(2024, 5, 1)) }); // 1Y
		await provider.getHistory('AAPL', { ...base, period1: SEC(Date.UTC(2025, 4, 1)) }); // 1M, same key

		expect(spy).toHaveBeenCalledTimes(1);
	});
});
