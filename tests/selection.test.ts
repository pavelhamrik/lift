import { describe, it, expect } from 'vitest';
import {
	parseSelection,
	parseSelectionParams,
	selectionToSearchParams,
	serializeSelection,
	loadStoredSelection,
	parseBasis,
	serializeBasis,
	isValidSymbol,
	normalizeSymbol,
	MAX_SYMBOLS,
	SELECTION_STORAGE_KEY,
	type StoredSelection
} from '../src/lib/selection.js';
import { BENCHMARKS } from '../src/lib/benchmarks.js';

/** Minimal in-memory Storage. */
function makeStorage(initial: Record<string, string> = {}): Storage {
	const map = new Map<string, string>(Object.entries(initial));
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
		key: (i: number) => Array.from(map.keys())[i] ?? null,
		removeItem: (k: string) => void map.delete(k),
		setItem: (k: string, v: string) => void map.set(k, String(v))
	};
}

describe('parseSelection (unified symbols)', () => {
	it('round-trips a valid selection', () => {
		const s: StoredSelection = {
			symbols: ['AAPL', 'MSFT', 'SPY'],
			basis: 'total-return',
			range: '1Y'
		};
		expect(parseSelection(serializeSelection(s))).toEqual(s);
	});

	it('round-trips a price-only basis', () => {
		const s: StoredSelection = { symbols: ['AAPL'], basis: 'price-only', range: '6M' };
		expect(parseSelection(serializeSelection(s))).toEqual(s);
	});

	it('canonicalizes case + whitespace on read', () => {
		const raw = JSON.stringify({ symbols: ['  aapl ', 'msft'], basis: 'total', range: '1y' });
		expect(parseSelection(raw)).toEqual({
			symbols: ['AAPL', 'MSFT'],
			basis: 'total-return',
			range: '1Y'
		});
	});

	it('dedupes symbols preserving first occurrence', () => {
		const raw = JSON.stringify({
			symbols: ['AAPL', 'aapl', ' AAPL ', 'MSFT'],
			basis: 'total',
			range: '1Y'
		});
		expect(parseSelection(raw)?.symbols).toEqual(['AAPL', 'MSFT']);
	});

	it('dedupes BEFORE clamping (duplicates do not consume the cap)', () => {
		// 17 unique symbols, with the first duplicated up front (18 entries total).
		const unique = Array.from({ length: 17 }, (_, i) => `SYM${i}`);
		const input = [unique[0], ...unique]; // SYM0 appears twice
		const raw = JSON.stringify({ symbols: input, basis: 'total', range: '1Y' });
		const out = parseSelection(raw);
		// dedupe-first → 17 unique → clamp to 16. (clamp-first would keep only 15.)
		expect(out?.symbols).toEqual(unique.slice(0, MAX_SYMBOLS));
		expect(out?.symbols.length).toBe(MAX_SYMBOLS);
	});

	it('clamps to MAX_SYMBOLS', () => {
		const many = Array.from({ length: MAX_SYMBOLS + 5 }, (_, i) => `T${i}`);
		const raw = JSON.stringify({ symbols: many, basis: 'total', range: '1Y' });
		expect(parseSelection(raw)?.symbols.length).toBe(MAX_SYMBOLS);
	});

	it('skips invalid symbols but keeps valid ones', () => {
		const raw = JSON.stringify({ symbols: ['AAPL', 'AA!', ''], basis: 'total', range: '1Y' });
		expect(parseSelection(raw)?.symbols).toEqual(['AAPL']);
	});

	it('defaults basis to total-return when absent or malformed', () => {
		expect(parseSelection(JSON.stringify({ symbols: ['AAPL'], range: '1Y' }))?.basis).toBe(
			'total-return'
		);
		expect(
			parseSelection(JSON.stringify({ symbols: ['AAPL'], basis: 'nonsense', range: '1Y' }))?.basis
		).toBe('total-return');
	});

	it('accepts digit-bearing, dotted, and hyphenated symbols', () => {
		const raw = JSON.stringify({
			symbols: ['BRK.B', 'BRK-B', '005930.KS', '000300.SS'],
			basis: 'price',
			range: 'YTD'
		});
		expect(parseSelection(raw)).toEqual({
			symbols: ['BRK.B', 'BRK-B', '005930.KS', '000300.SS'],
			basis: 'price-only',
			range: 'YTD'
		});
	});

	it('rejects when no valid symbols remain', () => {
		expect(
			parseSelection(JSON.stringify({ symbols: ['AA!'], basis: 'total', range: '1Y' }))
		).toBeNull();
		expect(parseSelection(JSON.stringify({ symbols: [], basis: 'total', range: '1Y' }))).toBeNull();
	});

	it('rejects a missing symbols array', () => {
		expect(parseSelection(JSON.stringify({ basis: 'total', range: '1Y' }))).toBeNull();
	});

	it('rejects unknown range', () => {
		expect(parseSelection(JSON.stringify({ symbols: ['AAPL'], range: '3D' }))).toBeNull();
	});

	it('rejects null / empty / malformed', () => {
		expect(parseSelection(null)).toBeNull();
		expect(parseSelection('')).toBeNull();
		expect(parseSelection('{not json')).toBeNull();
	});
});

describe('validator round-trip — every curated symbol survives (Finding 1)', () => {
	it('every BENCHMARKS key passes isValidSymbol and survives parsing', () => {
		for (const key of Object.keys(BENCHMARKS)) {
			expect(isValidSymbol(key)).toBe(true);
			expect(normalizeSymbol(key)).toBe(key);
			// JSON form
			expect(
				parseSelection(JSON.stringify({ symbols: [key], basis: 'total', range: '1Y' }))?.symbols
			).toEqual([key]);
			// URL form
			expect(
				parseSelectionParams(new URLSearchParams(`symbols=${encodeURIComponent(key)}&range=1Y`))
					?.symbols
			).toEqual([key]);
		}
	});

	it('rejects clearly invalid symbols', () => {
		expect(isValidSymbol('AA!')).toBe(false);
		expect(isValidSymbol('TOOLONGSYMBOL12345')).toBe(false);
		expect(isValidSymbol('')).toBe(false);
	});
});

describe('basis codec (Finding 8)', () => {
	it('round-trips total and price tokens', () => {
		expect(parseBasis(serializeBasis('total-return'))).toBe('total-return');
		expect(parseBasis(serializeBasis('price-only'))).toBe('price-only');
		expect(serializeBasis('total-return')).toBe('total');
		expect(serializeBasis('price-only')).toBe('price');
	});

	it('absent or malformed → default total-return', () => {
		expect(parseBasis(null)).toBe('total-return');
		expect(parseBasis(undefined)).toBe('total-return');
		expect(parseBasis('garbage')).toBe('total-return');
	});
});

describe('loadStoredSelection', () => {
	it('returns the parsed current-key selection', () => {
		const sel: StoredSelection = { symbols: ['NVDA'], basis: 'price-only', range: '6M' };
		const storage = makeStorage({ [SELECTION_STORAGE_KEY]: serializeSelection(sel) });
		expect(loadStoredSelection(storage)).toEqual(sel);
	});

	it('returns null when absent or unparseable', () => {
		expect(loadStoredSelection(makeStorage())).toBeNull();
		expect(loadStoredSelection(makeStorage({ [SELECTION_STORAGE_KEY]: '{not json' }))).toBeNull();
	});
});

describe('selection URL params (share links)', () => {
	it('round-trips a selection through search params', () => {
		const s: StoredSelection = { symbols: ['AAPL', 'MSFT'], basis: 'total-return', range: '1Y' };
		expect(parseSelectionParams(selectionToSearchParams(s))).toEqual(s);
	});

	it('produces readable query params', () => {
		const params = selectionToSearchParams({
			symbols: ['AAPL', 'MSFT'],
			basis: 'total-return',
			range: '1Y'
		});
		expect(params.toString()).toBe('symbols=AAPL%2CMSFT&basis=total&range=1Y');
	});

	it('canonicalizes case + whitespace and dedupes from params', () => {
		const params = new URLSearchParams('symbols=  aapl , msft , aapl &basis=price&range=1y');
		expect(parseSelectionParams(params)).toEqual({
			symbols: ['AAPL', 'MSFT'],
			basis: 'price-only',
			range: '1Y'
		});
	});

	it('returns null when no selection params are present', () => {
		expect(parseSelectionParams(new URLSearchParams('foo=bar'))).toBeNull();
		expect(parseSelectionParams(new URLSearchParams(''))).toBeNull();
	});

	it('returns null for an unknown range', () => {
		expect(parseSelectionParams(new URLSearchParams('symbols=AAPL&range=3D'))).toBeNull();
	});

	it('returns null when no valid symbols survive', () => {
		expect(
			parseSelectionParams(new URLSearchParams('symbols=AA!&basis=total&range=1Y'))
		).toBeNull();
	});
});
