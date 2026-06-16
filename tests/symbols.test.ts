import { describe, it, expect } from 'vitest';
import {
	buildBrowseList,
	searchLocal,
	mergeResults,
	kindForAsset,
	POPULAR_TICKERS,
	type SymbolSearchResult
} from '../src/lib/symbols.js';

describe('kindForAsset', () => {
	it('maps INDEX → index, everything else → equity', () => {
		expect(kindForAsset('INDEX')).toBe('index');
		expect(kindForAsset('ETF')).toBe('equity');
		expect(kindForAsset('EQUITY')).toBe('equity');
	});
});

describe('buildBrowseList', () => {
	it('leads with Popular, then the curated index regions', () => {
		const groups = buildBrowseList();
		expect(groups[0].group).toBe('Popular');
		expect(groups[0].entries.length).toBe(POPULAR_TICKERS.length);
		// ETF proxies render as colored equities; true indices as gray.
		const spy = groups.flatMap((g) => g.entries).find((e) => e.symbol === 'SPY');
		const gspc = groups.flatMap((g) => g.entries).find((e) => e.symbol === '^GSPC');
		expect(spy?.asset).toBe('ETF');
		expect(spy?.kind).toBe('equity');
		expect(gspc?.asset).toBe('INDEX');
		expect(gspc?.kind).toBe('index');
	});
});

describe('searchLocal', () => {
	it('ranks exact > prefix > substring > name match', () => {
		const r = searchLocal('AAP').map((e) => e.symbol);
		expect(r[0]).toBe('AAPL'); // prefix on symbol
	});

	it('matches on company name too', () => {
		const r = searchLocal('apple').map((e) => e.symbol);
		expect(r).toContain('AAPL');
	});

	it('finds digit-bearing curated indices', () => {
		expect(searchLocal('000300').map((e) => e.symbol)).toContain('000300.SS');
	});

	it('returns nothing for an empty query', () => {
		expect(searchLocal('   ')).toEqual([]);
	});
});

describe('mergeResults', () => {
	const local: SymbolSearchResult[] = [
		{ symbol: 'AAPL', name: 'Apple Inc.', asset: 'EQUITY', kind: 'equity' }
	];
	const remote: SymbolSearchResult[] = [
		{ symbol: 'AAPL', name: 'APPLE INC', asset: 'EQUITY', kind: 'equity', exchange: 'NMS' },
		{ symbol: 'AAPL.MX', name: 'Apple (Mexico)', asset: 'EQUITY', kind: 'equity' }
	];

	it('dedupes by symbol with the local entry winning on label', () => {
		const out = mergeResults(local, remote);
		const aapl = out.find((r) => r.symbol === 'AAPL')!;
		expect(aapl.name).toBe('Apple Inc.'); // local label kept
	});

	it('lists local matches first, then remote long-tail', () => {
		const out = mergeResults(local, remote).map((r) => r.symbol);
		expect(out).toEqual(['AAPL', 'AAPL.MX']);
	});
});
