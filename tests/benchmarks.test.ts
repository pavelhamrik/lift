import { describe, it, expect } from 'vitest';
import {
	BENCHMARKS,
	BENCHMARK_GROUP_LABELS,
	BENCHMARK_GROUP_ORDER,
	groupedBenchmarks
} from '../src/lib/benchmarks.js';

describe('BENCHMARKS allowlist', () => {
	it('every entry has a group, currency, and explicit asset', () => {
		for (const [, entry] of Object.entries(BENCHMARKS)) {
			expect(entry.group).toMatch(/^(US|Europe|Global|APAC)$/);
			expect(entry.currency).toMatch(/^[A-Z]{3}$/);
			expect(entry.asset === 'INDEX' || entry.asset === 'ETF').toBe(true);
		}
	});

	it('every ^-prefixed key and the .SS pair is an INDEX, not inferred from a policy proxy', () => {
		for (const [symbol, entry] of Object.entries(BENCHMARKS)) {
			if (symbol.startsWith('^') || symbol.endsWith('.SS')) {
				expect(entry.asset).toBe('INDEX');
			}
		}
	});

	it('the ETF proxies are typed ETF', () => {
		for (const sym of ['SPY', 'QQQ', 'IWM', 'URTH', 'EEM', 'ACWI']) {
			expect(BENCHMARKS[sym as keyof typeof BENCHMARKS].asset).toBe('ETF');
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
