import type { Range } from '$lib/providers/types.js';

export type AdjustmentPolicy = 'price-only' | 'total-return';

export type BenchmarkEntry = {
	label: string;
	policy: AdjustmentPolicy;
};

export const BENCHMARKS = {
	'^GSPC': { label: 'S&P 500 index (^GSPC)', policy: 'price-only' },
	SPY: { label: 'S&P 500 ETF (SPY)', policy: 'total-return' }
} as const satisfies Record<string, BenchmarkEntry>;

export type BenchmarkSymbol = keyof typeof BENCHMARKS;

export const DEFAULT_BENCHMARK: BenchmarkSymbol = 'SPY';
export const DEFAULT_RANGE: Range = '1Y';

export function isBenchmarkSymbol(s: string): s is BenchmarkSymbol {
	return Object.prototype.hasOwnProperty.call(BENCHMARKS, s);
}

export function effectiveReturnBasis(range: Range, bench: BenchmarkSymbol): AdjustmentPolicy {
	if (range === '1D') return 'price-only';
	return BENCHMARKS[bench].policy;
}

export function intervalForRange(range: Range): '1m' | '1d' {
	return range === '1D' ? '1m' : '1d';
}

export function adjustedFor(range: Range, bench: BenchmarkSymbol): boolean {
	if (range === '1D') return false;
	return BENCHMARKS[bench].policy === 'total-return';
}
