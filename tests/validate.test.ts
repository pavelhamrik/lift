import { describe, it, expect } from 'vitest';
import { canonicalizeAndValidate, canonicalCacheKey } from '../src/lib/server/validate.js';

describe('canonicalizeAndValidate', () => {
	it('uppercases, trims, and applies defaults', () => {
		const r = canonicalizeAndValidate({
			symbol: '  aapl  ',
			benchmark: null,
			range: null
		});
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.canonical.symbol).toBe('AAPL');
			expect(r.canonical.benchmark).toBe('SPY');
			expect(r.canonical.range).toBe('1Y');
		}
	});

	it('admits class-share dotted symbols (e.g. BRK.B)', () => {
		const r = canonicalizeAndValidate({ symbol: 'brk.b', benchmark: null, range: null });
		expect(r.ok).toBe(true);
	});

	it('admits index-style symbols (e.g. ^GSPC) as benchmark', () => {
		const r = canonicalizeAndValidate({ symbol: 'AAPL', benchmark: '^gspc', range: '1y' });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.canonical.benchmark).toBe('^GSPC');
	});

	it('rejects empty symbol', () => {
		const r = canonicalizeAndValidate({ symbol: '   ', benchmark: null, range: null });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.field).toBe('symbol');
	});

	it('rejects symbol that fails regex', () => {
		const r = canonicalizeAndValidate({ symbol: 'AA!', benchmark: null, range: null });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.field).toBe('symbol');
	});

	it('rejects benchmark outside curated allowlist', () => {
		const r = canonicalizeAndValidate({ symbol: 'AAPL', benchmark: 'XYZ', range: '1Y' });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.field).toBe('benchmark');
	});

	it('rejects unknown range', () => {
		const r = canonicalizeAndValidate({ symbol: 'AAPL', benchmark: 'SPY', range: '7D' });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.field).toBe('range');
	});

	it.each(['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'MAX'])('accepts range %s', (rangeStr) => {
		const r = canonicalizeAndValidate({ symbol: 'AAPL', benchmark: 'SPY', range: rangeStr });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.canonical.range).toBe(rangeStr);
	});

	it('cache key collapses lower/upper/whitespace variants', () => {
		const a = canonicalizeAndValidate({ symbol: '  aapl ', benchmark: 'spy', range: '1y' });
		const b = canonicalizeAndValidate({ symbol: 'AAPL', benchmark: 'SPY', range: '1Y' });
		expect(a.ok && b.ok).toBe(true);
		if (a.ok && b.ok) {
			expect(canonicalCacheKey(a.canonical)).toBe(canonicalCacheKey(b.canonical));
		}
	});
});
