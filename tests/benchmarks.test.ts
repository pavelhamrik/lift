import { describe, it, expect } from 'vitest';
import {
	BENCHMARKS,
	BENCHMARK_GROUP_LABELS,
	BENCHMARK_GROUP_ORDER,
	groupedBenchmarks,
	effectiveReturnBasis
} from '../src/lib/benchmarks.js';

describe('BENCHMARKS allowlist', () => {
	it('every entry has a group, currency, and policy', () => {
		for (const [, entry] of Object.entries(BENCHMARKS)) {
			expect(entry.group).toMatch(/^(US|Europe|Global|APAC)$/);
			expect(entry.currency).toMatch(/^[A-Z]{3}$/);
			expect(entry.policy === 'price-only' || entry.policy === 'total-return').toBe(true);
		}
	});

	it('indices use price-only policy, ETFs use total-return', () => {
		for (const [symbol, entry] of Object.entries(BENCHMARKS)) {
			if (symbol.startsWith('^')) expect(entry.policy).toBe('price-only');
		}
	});

	it('groupedBenchmarks returns each group in canonical order with non-empty entries', () => {
		const g = groupedBenchmarks();
		expect(g.map((x) => x.group)).toEqual(BENCHMARK_GROUP_ORDER);
		for (const section of g) expect(section.entries.length).toBeGreaterThan(0);
	});

	it('every group has a non-empty headline', () => {
		for (const group of BENCHMARK_GROUP_ORDER) {
			expect(BENCHMARK_GROUP_LABELS[group]).toBeTruthy();
		}
	});
});

describe('effectiveReturnBasis with non-US benchmarks', () => {
	it('FTSE 100 on 1Y is price-only (index policy)', () => {
		expect(effectiveReturnBasis('1Y', '^FTSE')).toBe('price-only');
	});

	it('URTH (MSCI World ETF) on 1Y is total-return', () => {
		expect(effectiveReturnBasis('1Y', 'URTH')).toBe('total-return');
	});

	it('1D forces price-only regardless of benchmark', () => {
		expect(effectiveReturnBasis('1D', 'URTH')).toBe('price-only');
		expect(effectiveReturnBasis('1D', '^N225')).toBe('price-only');
	});
});
