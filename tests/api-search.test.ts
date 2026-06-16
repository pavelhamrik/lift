import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SymbolSearchResult } from '../src/lib/symbols.js';

const ORIGINAL = process.env.STOCK_FIXTURES;

async function call(qs: string): Promise<Response> {
	const { GET } = await import('../src/routes/api/search/+server.js');
	const url = new URL(`http://localhost/api/search?${qs}`);
	return GET({
		url,
		request: new Request(url),
		getClientAddress: () => '1.2.3.4',
		platform: undefined
	} as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/search (fixture mode)', () => {
	beforeEach(() => {
		vi.resetModules();
		process.env.STOCK_FIXTURES = '1';
	});
	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.STOCK_FIXTURES;
		else process.env.STOCK_FIXTURES = ORIGINAL;
		vi.restoreAllMocks();
	});

	it('returns [] below the 2-char threshold', async () => {
		const res = await call('q=A');
		expect(res.status).toBe(200);
		expect((await res.json()) as SymbolSearchResult[]).toEqual([]);
	});

	it('resolves local matches with zero network', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
			throw new Error('fetch must not be called in fixture mode');
		});
		const res = await call('q=AAP');
		const body = (await res.json()) as SymbolSearchResult[];
		expect(body.some((r) => r.symbol === 'AAPL')).toBe(true);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('appends a synthetic exact match for an unknown symbol (keeps the "any symbol" promise)', async () => {
		const res = await call('q=ZZZZ');
		const body = (await res.json()) as SymbolSearchResult[];
		const exact = body.find((r) => r.symbol === 'ZZZZ');
		expect(exact).toBeDefined();
		expect(exact?.asset).toBe('EQUITY');
		expect(exact?.kind).toBe('equity');
	});
});

describe('GET /api/search (live mode → Yahoo lookup)', () => {
	beforeEach(() => {
		vi.resetModules();
		// Exercise the upstream path, not the fixture short-circuit.
		delete process.env.STOCK_FIXTURES;
	});
	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.STOCK_FIXTURES;
		else process.env.STOCK_FIXTURES = ORIGINAL;
		vi.restoreAllMocks();
	});

	function mockLookup(documents: unknown[]) {
		return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ finance: { result: [{ documents }] } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
	}

	it('queries the lookup endpoint with a type filter and maps documents', async () => {
		const spy = mockLookup([
			{ symbol: '^GSPC', shortName: 'S&P 500', quoteType: 'index', exchange: 'SNP' },
			{ symbol: 'SPY', shortName: 'SPDR S&P 500 ETF', quoteType: 'etf', exchange: 'PCX' },
			// A future sneaks through upstream — the defense-in-depth guard must still drop it.
			{ symbol: 'ES=F', shortName: 'E-Mini S&P 500', quoteType: 'future', exchange: 'CME' }
		]);
		const res = await call(`q=${encodeURIComponent('s&p')}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SymbolSearchResult[];

		expect(body.map((r) => r.symbol)).toEqual(['^GSPC', 'SPY']); // future dropped
		// Lowercase quoteType → asset/kind; name from shortName; cryptic exchange dropped.
		expect(body[0]).toMatchObject({
			symbol: '^GSPC',
			name: 'S&P 500',
			asset: 'INDEX',
			kind: 'index'
		});
		expect(body[1]).toMatchObject({ asset: 'ETF', kind: 'equity' });
		expect(body[0].exchange).toBeUndefined();

		const reqUrl = new URL(String(spy.mock.calls[0][0]));
		expect(reqUrl.pathname).toContain('/v1/finance/lookup');
		expect(reqUrl.searchParams.get('type')).toBe('equity,etf,index');
		expect(reqUrl.searchParams.get('query')).toBe('s&p');
	});

	it('502s on an upstream failure (and does not cache it)', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream boom', { status: 500 }));
		await expect(call(`q=${encodeURIComponent('s&p')}`)).rejects.toMatchObject({ status: 502 });
	});
});
