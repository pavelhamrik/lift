import { describe, it, expect } from 'vitest';
import {
	parseSelection,
	parseSelectionParams,
	selectionToSearchParams,
	serializeSelection,
	loadStoredSelection,
	SELECTION_STORAGE_KEY
} from '../src/lib/selection.js';

const LEGACY_KEY = 'stock-compare:selection';

/** Minimal in-memory Storage for migration tests. */
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

describe('parseSelection (multi)', () => {
	it('round-trips a valid multi selection', () => {
		const s = {
			stocks: ['AAPL', 'MSFT'],
			compares: ['SPY' as const, 'QQQ' as const],
			range: '1Y' as const
		};
		expect(parseSelection(serializeSelection(s))).toEqual(s);
	});

	it('canonicalizes case + whitespace on read', () => {
		const raw = JSON.stringify({
			stocks: ['  aapl ', 'msft'],
			compares: ['spy'],
			range: '1y'
		});
		expect(parseSelection(raw)).toEqual({
			stocks: ['AAPL', 'MSFT'],
			compares: ['SPY'],
			range: '1Y'
		});
	});

	it('dedupes stocks and compares', () => {
		const raw = JSON.stringify({
			stocks: ['AAPL', 'aapl', 'MSFT'],
			compares: ['SPY', 'spy'],
			range: '1Y'
		});
		expect(parseSelection(raw)).toEqual({
			stocks: ['AAPL', 'MSFT'],
			compares: ['SPY'],
			range: '1Y'
		});
	});

	it('skips invalid stocks but keeps valid ones', () => {
		const raw = JSON.stringify({
			stocks: ['AAPL', 'AA!', ''],
			compares: ['SPY'],
			range: '1Y'
		});
		expect(parseSelection(raw)).toEqual({
			stocks: ['AAPL'],
			compares: ['SPY'],
			range: '1Y'
		});
	});

	it('skips compares outside the allowlist', () => {
		const raw = JSON.stringify({
			stocks: ['AAPL'],
			compares: ['SPY', 'NOPE'],
			range: '1Y'
		});
		expect(parseSelection(raw)).toEqual({
			stocks: ['AAPL'],
			compares: ['SPY'],
			range: '1Y'
		});
	});

	it('migrates legacy single-pair shape', () => {
		const raw = JSON.stringify({ symbol: 'AAPL', benchmark: 'SPY', range: '1Y' });
		expect(parseSelection(raw)).toEqual({
			stocks: ['AAPL'],
			compares: ['SPY'],
			range: '1Y'
		});
	});

	it('rejects when no valid stocks remain', () => {
		const raw = JSON.stringify({ stocks: ['AA!'], compares: ['SPY'], range: '1Y' });
		expect(parseSelection(raw)).toBeNull();
	});

	it('rejects unknown range', () => {
		const raw = JSON.stringify({ stocks: ['AAPL'], compares: ['SPY'], range: '3D' });
		expect(parseSelection(raw)).toBeNull();
	});

	it('rejects null / empty / malformed', () => {
		expect(parseSelection(null)).toBeNull();
		expect(parseSelection('')).toBeNull();
		expect(parseSelection('{not json')).toBeNull();
	});

	it('accepts an exotic benchmark and dotted-class symbol', () => {
		const raw = JSON.stringify({
			stocks: ['BRK.B'],
			compares: ['000300.SS'],
			range: 'YTD'
		});
		expect(parseSelection(raw)).toEqual({
			stocks: ['BRK.B'],
			compares: ['000300.SS'],
			range: 'YTD'
		});
	});
});

describe('loadStoredSelection (key migration)', () => {
	const current = { stocks: ['NVDA'], compares: ['QQQ' as const], range: '6M' as const };
	const legacy = { stocks: ['AAPL'], compares: ['SPY' as const], range: '1Y' as const };

	it('returns the current-key selection and ignores the legacy key', () => {
		const storage = makeStorage({
			[SELECTION_STORAGE_KEY]: serializeSelection(current),
			[LEGACY_KEY]: serializeSelection(legacy)
		});
		expect(loadStoredSelection(storage)).toEqual(current);
		// Current wins; the legacy key is left untouched (not consumed).
		expect(parseSelection(storage.getItem(LEGACY_KEY))).toEqual(legacy);
	});

	it('migrates the legacy key forward when no current key exists', () => {
		const storage = makeStorage({ [LEGACY_KEY]: serializeSelection(legacy) });
		expect(loadStoredSelection(storage)).toEqual(legacy);
		// Copied to the current key...
		expect(parseSelection(storage.getItem(SELECTION_STORAGE_KEY))).toEqual(legacy);
		// ...and the legacy key removed so the migration runs only once.
		expect(storage.getItem(LEGACY_KEY)).toBeNull();
	});

	it('returns null and writes nothing when neither key is present', () => {
		const storage = makeStorage();
		expect(loadStoredSelection(storage)).toBeNull();
		expect(storage.getItem(SELECTION_STORAGE_KEY)).toBeNull();
		expect(storage.getItem(LEGACY_KEY)).toBeNull();
	});

	it('does not migrate an unparseable legacy value', () => {
		const storage = makeStorage({ [LEGACY_KEY]: '{not json' });
		expect(loadStoredSelection(storage)).toBeNull();
		expect(storage.getItem(SELECTION_STORAGE_KEY)).toBeNull();
		// A malformed legacy value is left as-is rather than silently dropped.
		expect(storage.getItem(LEGACY_KEY)).toBe('{not json');
	});

	it('still returns the legacy selection when the migration write throws', () => {
		const storage = makeStorage({ [LEGACY_KEY]: serializeSelection(legacy) });
		let removed = false;
		storage.setItem = () => {
			throw new DOMException('QuotaExceededError');
		};
		const origRemove = storage.removeItem.bind(storage);
		storage.removeItem = (k: string) => {
			removed = true;
			origRemove(k);
		};
		// The valid selection survives a write failure...
		expect(loadStoredSelection(storage)).toEqual(legacy);
		// ...and the legacy key is NOT removed, so the migration can retry later.
		expect(removed).toBe(false);
		expect(parseSelection(storage.getItem(LEGACY_KEY))).toEqual(legacy);
	});
});

describe('selection URL params (share links)', () => {
	it('round-trips a selection through search params', () => {
		const s = {
			stocks: ['AAPL', 'MSFT'],
			compares: ['SPY' as const, 'QQQ' as const],
			range: '1Y' as const
		};
		const params = selectionToSearchParams(s);
		expect(parseSelectionParams(params)).toEqual(s);
	});

	it('produces readable query params', () => {
		const params = selectionToSearchParams({
			stocks: ['AAPL', 'MSFT'],
			compares: ['SPY'],
			range: '1Y'
		});
		expect(params.toString()).toBe('stocks=AAPL%2CMSFT&compares=SPY&range=1Y');
	});

	it('omits the compares param when there are none', () => {
		const params = selectionToSearchParams({ stocks: ['AAPL'], compares: [], range: '6M' });
		expect(params.has('compares')).toBe(false);
		expect(parseSelectionParams(params)).toEqual({ stocks: ['AAPL'], compares: [], range: '6M' });
	});

	it('canonicalizes case + whitespace and dedupes from params', () => {
		const params = new URLSearchParams('stocks=  aapl , msft , aapl &compares=spy,spy&range=1y');
		expect(parseSelectionParams(params)).toEqual({
			stocks: ['AAPL', 'MSFT'],
			compares: ['SPY'],
			range: '1Y'
		});
	});

	it('returns null when no selection params are present', () => {
		expect(parseSelectionParams(new URLSearchParams('foo=bar'))).toBeNull();
		expect(parseSelectionParams(new URLSearchParams(''))).toBeNull();
	});

	it('returns null for an unknown range', () => {
		expect(parseSelectionParams(new URLSearchParams('stocks=AAPL&range=3D'))).toBeNull();
	});

	it('returns null when no valid stocks survive', () => {
		expect(
			parseSelectionParams(new URLSearchParams('stocks=AA!&compares=SPY&range=1Y'))
		).toBeNull();
	});
});
