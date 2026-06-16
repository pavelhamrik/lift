import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL = process.env.STOCK_FIXTURES;

type LookupBody = {
	symbol: string;
	name: string;
	asset: 'EQUITY' | 'ETF' | 'INDEX';
	kind: 'equity' | 'index';
	currency?: string;
};

async function call(symbol: string): Promise<Response> {
	const { GET } = await import('../src/routes/api/lookup/+server.js');
	const url = new URL(`http://localhost/api/lookup?symbol=${encodeURIComponent(symbol)}`);
	return GET({
		url,
		request: new Request(url),
		getClientAddress: () => '9.9.9.9',
		platform: undefined
	} as unknown as Parameters<typeof GET>[0]);
}

function yahoo(quotes: unknown[]): Response {
	return new Response(JSON.stringify({ quotes }), { status: 200 });
}

describe('GET /api/lookup — fixture mode', () => {
	beforeEach(() => {
		vi.resetModules();
		process.env.STOCK_FIXTURES = '1';
	});
	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.STOCK_FIXTURES;
		else process.env.STOCK_FIXTURES = ORIGINAL;
		vi.restoreAllMocks();
	});

	it('resolves a 1-char symbol without touching the network', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
			throw new Error('no network in fixture mode');
		});
		const body = (await (await call('F')).json()) as LookupBody;
		expect(body.symbol).toBe('F');
		expect(body.asset).toBe('EQUITY');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns the curated asset/kind for a benchmark', async () => {
		const body = (await (await call('SPY')).json()) as LookupBody;
		expect(body.asset).toBe('ETF');
		expect(body.kind).toBe('equity');
		expect(body.currency).toBe('USD');
	});
});

describe('GET /api/lookup — live path (mocked Yahoo)', () => {
	beforeEach(() => {
		vi.resetModules();
		delete process.env.STOCK_FIXTURES;
	});
	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.STOCK_FIXTURES;
		else process.env.STOCK_FIXTURES = ORIGINAL;
		vi.restoreAllMocks();
	});

	it('resolves an exact match (incl. a long-tail symbol)', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			yahoo([{ symbol: 'NFLX', quoteType: 'EQUITY', longname: 'Netflix, Inc.', currency: 'USD' }])
		);
		const res = await call('NFLX');
		expect(res.status).toBe(200);
		const body = (await res.json()) as LookupBody;
		expect(body).toMatchObject({ symbol: 'NFLX', asset: 'EQUITY', kind: 'equity' });
	});

	it('rejects an inexact top-ranked result with 404 (no near-miss substitution)', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			yahoo([{ symbol: 'FOOBAR', quoteType: 'EQUITY', longname: 'Foobar Inc' }])
		);
		await expect(call('FOO')).rejects.toMatchObject({ status: 404 });
	});

	it('rejects an unsupported exact hit (crypto/futures) with 404', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			yahoo([{ symbol: 'XCRYPTO', quoteType: 'CRYPTOCURRENCY', longname: 'X Coin' }])
		);
		await expect(call('XCRYPTO')).rejects.toMatchObject({ status: 404 });
	});

	it('does not poison the cache on a transient failure', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		fetchSpy.mockResolvedValueOnce(new Response('upstream down', { status: 500 }));
		await expect(call('NFLX')).rejects.toMatchObject({ status: 502 });
		// A later success for the same symbol must resolve — not return a cached 404.
		fetchSpy.mockResolvedValueOnce(
			yahoo([{ symbol: 'NFLX', quoteType: 'EQUITY', longname: 'Netflix, Inc.' }])
		);
		const res = await call('NFLX');
		expect(res.status).toBe(200);
	});
});
