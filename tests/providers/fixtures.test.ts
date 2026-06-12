import { describe, it, expect, vi, afterEach } from 'vitest';
import { fixtureFetch } from '../../src/lib/providers/fixtures.js';
import { buildResultFromChart, mapInstrumentMeta } from '../../src/lib/providers/yahoo.js';
import { pctChangeSeries } from '../../src/lib/chart/normalize.js';
import type { HistoryRequest } from '../../src/lib/providers/types.js';

const SEC = (ms: number) => Math.floor(ms / 1000);

function localMinutes(tsSec: number, tz: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(new Date(tsSec * 1000));
	let h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
	if (h === 24) h = 0;
	const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
	return h * 60 + m;
}

describe('fixtureFetch — deterministic raw curve', () => {
	it('returns identical raw closes on shared timestamps across overlapping ranges', async () => {
		const period2 = new Date(Date.UTC(2025, 5, 30));
		const wide = await fixtureFetch('AAPL', {
			period1: new Date(Date.UTC(2024, 0, 1)),
			period2,
			interval: '1d',
			includePrePost: false
		});
		const narrow = await fixtureFetch('AAPL', {
			period1: new Date(Date.UTC(2025, 0, 1)),
			period2,
			interval: '1d',
			includePrePost: false
		});

		const wideByTime = new Map(wide.quotes.map((q) => [q.date.getTime(), q.close]));
		let shared = 0;
		for (const q of narrow.quotes) {
			const w = wideByTime.get(q.date.getTime());
			if (w !== undefined) {
				shared++;
				expect(q.close).toBe(w);
			}
		}
		expect(shared).toBeGreaterThan(0);

		// Both windows end at the same period2, so the latest raw bar matches.
		expect(narrow.quotes.at(-1)!.close).toBe(wide.quotes.at(-1)!.close);
	});

	it('close(symbol, t) is a pure function of absolute time, not window', async () => {
		const a = await fixtureFetch('SPY', {
			period1: new Date(Date.UTC(2024, 3, 1)),
			period2: new Date(Date.UTC(2024, 3, 30)),
			interval: '1d',
			includePrePost: false
		});
		const b = await fixtureFetch('SPY', {
			period1: new Date(Date.UTC(2024, 0, 1)),
			period2: new Date(Date.UTC(2024, 11, 31)),
			interval: '1d',
			includePrePost: false
		});
		const bByTime = new Map(b.quotes.map((q) => [q.date.getTime(), q.close]));
		const probe = a.quotes[Math.floor(a.quotes.length / 2)];
		expect(probe).toBeDefined();
		expect(bByTime.get(probe.date.getTime())).toBe(probe.close);
	});
});

describe('fixtureFetch — MAX (period1 = 0) stays finite and positive', () => {
	it('every generated close is finite and strictly positive', async () => {
		for (const sym of ['SPY', '^GSPC', 'AAPL', '^N225']) {
			const raw = await fixtureFetch(sym, {
				period1: new Date(0),
				period2: new Date(Date.UTC(2026, 5, 1)),
				interval: '1mo',
				includePrePost: false
			});
			expect(raw.quotes.length).toBeGreaterThan(0);
			for (const q of raw.quotes) {
				expect(Number.isFinite(q.close)).toBe(true);
				expect(q.close as number).toBeGreaterThan(0);
				expect(Number.isFinite(q.adjclose as number)).toBe(true);
				expect(q.adjclose as number).toBeGreaterThan(0);
			}
		}
	});
});

describe('fixtureFetch — explicit instrument metadata', () => {
	const cases: Array<[string, 'INDEX' | 'ETF' | 'EQUITY']> = [
		['^GSPC', 'INDEX'],
		['SPY', 'ETF'],
		['QQQ', 'ETF'],
		['000001.SS', 'INDEX'],
		['000300.SS', 'INDEX'],
		['^N225', 'INDEX'],
		['ZZZZ', 'EQUITY'] // unknown ad-hoc ticker
	];
	for (const [sym, asset] of cases) {
		it(`${sym} maps to ${asset}`, async () => {
			const raw = await fixtureFetch(sym, {
				period1: new Date(Date.UTC(2025, 0, 1)),
				period2: new Date(Date.UTC(2025, 5, 1)),
				interval: '1d',
				includePrePost: false
			});
			expect(mapInstrumentMeta(raw.meta).asset).toBe(asset);
		});
	}

	it('the .SS pair carries CNY and a Shanghai session, not US defaults', async () => {
		const raw = await fixtureFetch('000300.SS', {
			period1: new Date(Date.UTC(2025, 0, 1)),
			period2: new Date(Date.UTC(2025, 5, 1)),
			interval: '1d',
			includePrePost: false
		});
		expect(raw.meta.currency).toBe('CNY');
		expect(raw.meta.exchangeTimezoneName).toBe('Asia/Shanghai');
	});
});

describe('fixtureFetch — intraday session grids', () => {
	// A full trading week to guarantee several weekday sessions.
	const period1 = new Date(Date.UTC(2025, 5, 9)); // Mon 2025-06-09
	const period2 = new Date(Date.UTC(2025, 5, 13, 23, 59, 59)); // Fri

	it('US 1m bars fall only inside the NY session', async () => {
		const raw = await fixtureFetch('SPY', {
			period1,
			period2,
			interval: '1m',
			includePrePost: false
		});
		expect(raw.quotes.length).toBeGreaterThan(0);
		for (const q of raw.quotes) {
			const m = localMinutes(SEC(q.date.getTime()), 'America/New_York');
			expect(m).toBeGreaterThanOrEqual(9 * 60 + 30);
			expect(m).toBeLessThan(16 * 60);
		}
		// 5 weekday sessions x 390 1m bars upper bound; sane lower bound too.
		expect(raw.quotes.length).toBeGreaterThanOrEqual(390);
		expect(raw.quotes.length).toBeLessThanOrEqual(5 * 390);
	});

	it('a non-US benchmark uses its own session, not US hours', async () => {
		const raw = await fixtureFetch('^N225', {
			period1,
			period2,
			interval: '1m',
			includePrePost: false
		});
		expect(raw.quotes.length).toBeGreaterThan(0);
		for (const q of raw.quotes) {
			const sec = SEC(q.date.getTime());
			// In Tokyo's own session ...
			const tokyo = localMinutes(sec, 'Asia/Tokyo');
			expect(tokyo).toBeGreaterThanOrEqual(9 * 60);
			expect(tokyo).toBeLessThan(15 * 60);
			// ... and outside US hours (sessions don't coincide).
			const ny = localMinutes(sec, 'America/New_York');
			expect(ny >= 9 * 60 + 30 && ny < 16 * 60).toBe(false);
		}
	});

	it('grids align across same-session symbols', async () => {
		const opts = { period1, period2, interval: '1m' as const, includePrePost: false };
		const a = await fixtureFetch('^GSPC', opts);
		const b = await fixtureFetch('SPY', opts);
		const at = a.quotes.map((q) => q.date.getTime());
		const bt = b.quotes.map((q) => q.date.getTime());
		expect(at).toEqual(bt);
	});

	it('daily grid skips weekends and yields a sane count over a year', async () => {
		const raw = await fixtureFetch('SPY', {
			period1: new Date(Date.UTC(2024, 0, 1)),
			period2: new Date(Date.UTC(2024, 11, 31)),
			interval: '1d',
			includePrePost: false
		});
		for (const q of raw.quotes) {
			const dow = q.date.getUTCDay();
			expect(dow).not.toBe(0);
			expect(dow).not.toBe(6);
		}
		expect(raw.quotes.length).toBeGreaterThan(200);
		expect(raw.quotes.length).toBeLessThanOrEqual(262);
	});
});

describe('fixtureFetch — adjustment factor', () => {
	const period1 = new Date(Date.UTC(2023, 0, 1));
	const period2 = new Date(Date.UTC(2024, 0, 1));
	const now = new Date(Date.UTC(2024, 0, 2));

	function reqFor(adjusted: boolean): HistoryRequest {
		return {
			interval: '1d',
			session: 'regular',
			adjusted,
			period1: SEC(period1.getTime()),
			period2: SEC(period2.getTime())
		};
	}

	it('keeps 0 <= adjFactor <= 1 within a request and ~1 at the latest bar', async () => {
		const raw = await fixtureFetch('SPY', {
			period1,
			period2,
			interval: '1d',
			includePrePost: false
		});
		for (const q of raw.quotes) {
			const f = (q.adjclose as number) / (q.close as number);
			expect(f).toBeGreaterThanOrEqual(0);
			expect(f).toBeLessThanOrEqual(1 + 1e-9);
		}
		const last = raw.quotes.at(-1)!;
		expect((last.adjclose as number) / (last.close as number)).toBeCloseTo(1, 2);
	});

	it('adjusted vs unadjusted ETF curves diverge after pctChange rebasing', async () => {
		const raw = await fixtureFetch('SPY', {
			period1,
			period2,
			interval: '1d',
			includePrePost: false
		});
		const adj = buildResultFromChart(raw, reqFor(true), now, 'SPY');
		const un = buildResultFromChart(raw, reqFor(false), now, 'SPY');
		const adjNorm = pctChangeSeries(adj.bars.map((b) => ({ time: b.time, close: b.close })));
		const unNorm = pctChangeSeries(un.bars.map((b) => ({ time: b.time, close: b.close })));
		expect(adjNorm.length).toBeGreaterThan(1);
		expect(adjNorm.at(-1)!.value).not.toBeCloseTo(unNorm.at(-1)!.value, 2);
	});

	it('index curves are identical regardless of adjusted flag', async () => {
		const raw = await fixtureFetch('^GSPC', {
			period1,
			period2,
			interval: '1d',
			includePrePost: false
		});
		const adj = buildResultFromChart(raw, reqFor(true), now, '^GSPC');
		const un = buildResultFromChart(raw, reqFor(false), now, '^GSPC');
		expect(adj.bars.map((b) => b.close)).toEqual(un.bars.map((b) => b.close));
	});
});

describe('fixture mode — selector + handler isolation', () => {
	const ORIGINAL = process.env.STOCK_FIXTURES;

	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.STOCK_FIXTURES;
		else process.env.STOCK_FIXTURES = ORIGINAL;
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it('getProvider().getHistory serves fixtures without touching fetch', async () => {
		process.env.STOCK_FIXTURES = '1';
		vi.resetModules();
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
			throw new Error('fetch must not be called in fixture mode');
		});
		const { getProvider } = await import('../../src/lib/providers/index.js');
		const req: HistoryRequest = {
			interval: '1d',
			session: 'regular',
			adjusted: false,
			period1: SEC(Date.UTC(2025, 0, 1)),
			period2: SEC(Date.UTC(2025, 5, 1))
		};
		const { result } = await getProvider().getHistory('AAPL', req);
		expect(result.bars.length).toBeGreaterThan(0);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('the lookup GET handler short-circuits without touching fetch', async () => {
		process.env.STOCK_FIXTURES = '1';
		vi.resetModules();
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
			throw new Error('fetch must not be called in fixture mode');
		});
		const { GET } = await import('../../src/routes/api/lookup/+server.js');
		const url = new URL('http://localhost/api/lookup?symbol=SPY');
		const res = await GET({
			url,
			request: new Request(url),
			getClientAddress: () => '1.2.3.4',
			platform: undefined
		} as unknown as Parameters<typeof GET>[0]);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { symbol: string; currency?: string };
		expect(body.symbol).toBe('SPY');
		expect(body.currency).toBe('USD');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('getChartFetcher returns the real defaultFetch when the flag is unset', async () => {
		delete process.env.STOCK_FIXTURES;
		vi.resetModules();
		const { getChartFetcher } = await import('../../src/lib/providers/index.js');
		const { defaultFetch } = await import('../../src/lib/providers/yahoo.js');
		expect(getChartFetcher()).toBe(defaultFetch);
	});
});
