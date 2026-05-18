import { describe, it, expect } from 'vitest';
import { innerJoinByTime, windowedPctChange } from '../src/lib/chart/normalize.js';
import { effectiveReturnBasis } from '../src/lib/benchmarks.js';

describe('summary derives from aligned series', () => {
	it('pctChange matches (last-first)/first*100 on the aligned series', () => {
		const t = [
			{ time: 1, close: 100, volume: 10 },
			{ time: 2, close: 110, volume: 20 },
			{ time: 3, close: 115, volume: 30 }
		];
		const b = [
			{ time: 2, close: 200, volume: 0 },
			{ time: 3, close: 220, volume: 0 }
		];
		const aligned = innerJoinByTime(t, b);
		const tPct = windowedPctChange(aligned.target);
		const bPct = windowedPctChange(aligned.benchmark);
		expect(tPct).toBeCloseTo(((115 - 110) / 110) * 100, 9);
		expect(bPct).toBeCloseTo(((220 - 200) / 200) * 100, 9);
	});

	it('target windowed pct uses the inner-join, not the raw target series', () => {
		const t = [
			{ time: 1, close: 100, volume: 0 },
			{ time: 2, close: 110, volume: 0 },
			{ time: 3, close: 115, volume: 0 }
		];
		const b = [{ time: 3, close: 200, volume: 0 }];
		const aligned = innerJoinByTime(t, b);
		expect(windowedPctChange(aligned.target)).toBe(0);
	});
});

describe('effectiveReturnBasis', () => {
	it('1D forces price-only regardless of benchmark policy', () => {
		expect(effectiveReturnBasis('1D', 'SPY')).toBe('price-only');
		expect(effectiveReturnBasis('1D', '^GSPC')).toBe('price-only');
	});

	it('1Y reflects the benchmark policy', () => {
		expect(effectiveReturnBasis('1Y', 'SPY')).toBe('total-return');
		expect(effectiveReturnBasis('1Y', '^GSPC')).toBe('price-only');
	});
});
