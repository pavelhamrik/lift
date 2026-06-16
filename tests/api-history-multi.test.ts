import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL = process.env.STOCK_FIXTURES;

type MultiBody = {
	series: Array<{
		symbol: string;
		kind: 'equity' | 'index';
		asset: 'EQUITY' | 'ETF' | 'INDEX';
		aligned: Array<{ time: number; close: number }>;
		summary: { pctChange?: number };
	}>;
	primaryVolume: { symbol: string; data: Array<{ time: number; volume: number }> };
	meta: { timezone: string; baseTime: number; returnBasis: 'price-only' | 'total-return' };
};

async function call(qs: string): Promise<Response> {
	const { GET } = await import('../src/routes/api/history-multi/+server.js');
	const url = new URL(`http://localhost/api/history-multi?${qs}`);
	return GET({
		url,
		request: new Request(url),
		getClientAddress: () => '1.2.3.4',
		platform: undefined
	} as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/history-multi (fixture mode)', () => {
	beforeEach(() => {
		vi.resetModules();
		process.env.STOCK_FIXTURES = '1';
		// Pin the clock to a fixed weekday during US market hours. The synthetic
		// fixtures key off "now", so an unpinned run on a weekend or pre-open
		// Monday leaves the 1D/5D intraday window with no session bars → 502.
		// Fake only Date (not timers) so async/fetch are unaffected.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.UTC(2026, 5, 10, 18, 0, 0)); // Wed 2026-06-10, ~14:00 ET
	});
	afterEach(() => {
		vi.useRealTimers();
		if (ORIGINAL === undefined) delete process.env.STOCK_FIXTURES;
		else process.env.STOCK_FIXTURES = ORIGINAL;
		vi.restoreAllMocks();
	});

	it('stamps kind + asset from instrument metadata', async () => {
		const res = await call('symbols=AAPL,^GSPC&range=1Y');
		expect(res.status).toBe(200);
		const body = (await res.json()) as MultiBody;
		const aapl = body.series.find((s) => s.symbol === 'AAPL')!;
		const gspc = body.series.find((s) => s.symbol === '^GSPC')!;
		expect(aapl.kind).toBe('equity');
		expect(aapl.asset).toBe('EQUITY');
		expect(gspc.kind).toBe('index');
		expect(gspc.asset).toBe('INDEX');
		expect(typeof body.meta.baseTime).toBe('number');
	});

	it('anchors volume AND timezone on the first equity even when an index is listed first', async () => {
		const res = await call('symbols=^GSPC,AAPL&range=1Y');
		const body = (await res.json()) as MultiBody;
		expect(body.primaryVolume.symbol).toBe('AAPL');
		expect(body.primaryVolume.data.length).toBeGreaterThan(0);
		expect(body.meta.timezone).toBe('America/New_York');
	});

	it('maps basis → returnBasis on daily ranges and forces price-only on intraday', async () => {
		const total = (await (await call('symbols=SPY&basis=total&range=1Y')).json()) as MultiBody;
		const price = (await (await call('symbols=SPY&basis=price&range=1Y')).json()) as MultiBody;
		expect(total.meta.returnBasis).toBe('total-return');
		expect(price.meta.returnBasis).toBe('price-only');
		const intraday = (await (await call('symbols=SPY&basis=total&range=1D')).json()) as MultiBody;
		expect(intraday.meta.returnBasis).toBe('price-only');
	});

	it('separates the cache by basis (total vs price diverge for an ETF)', async () => {
		const total = (await (await call('symbols=SPY&basis=total&range=1Y')).json()) as MultiBody;
		const price = (await (await call('symbols=SPY&basis=price&range=1Y')).json()) as MultiBody;
		const tLast = total.series[0].aligned.at(-1)!.close;
		const pLast = price.series[0].aligned.at(-1)!.close;
		expect(tLast).not.toBe(pLast); // dividend adjustment changes the curve
	});

	it('keeps non-overlapping intraday selections non-empty (union + LOCF, no 502)', async () => {
		// AAPL (NY session) vs ^N225 (Tokyo session) never overlap intraday; the old
		// inner-join 502'd. Union+LOCF keeps both, and volume uses the anchor's own bars.
		const res = await call('symbols=AAPL,^N225&range=5D');
		expect(res.status).toBe(200);
		const body = (await res.json()) as MultiBody;
		expect(body.series.every((s) => s.aligned.length > 0)).toBe(true);
		expect(body.primaryVolume.symbol).toBe('AAPL');
		expect(body.primaryVolume.data.length).toBeGreaterThan(0);
	});

	it('rejects a malformed basis token with 400', async () => {
		await expect(call('symbols=AAPL&basis=bogus&range=1Y')).rejects.toMatchObject({ status: 400 });
	});

	it('rejects an empty symbol list and an over-cap list with 400', async () => {
		await expect(call('range=1Y')).rejects.toMatchObject({ status: 400 });
		const tooMany = Array.from({ length: 17 }, (_, i) => `T${i}`).join(',');
		await expect(call(`symbols=${tooMany}&range=1Y`)).rejects.toMatchObject({ status: 400 });
	});
});
