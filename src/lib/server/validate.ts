import { RANGES, type Range } from '$lib/providers/types.js';
import {
	BENCHMARKS,
	DEFAULT_BENCHMARK,
	DEFAULT_RANGE,
	isBenchmarkSymbol,
	type BenchmarkSymbol
} from '$lib/benchmarks.js';

const SYMBOL_RE = /^[A-Z\^.\-]{1,8}$/;

export type Canonical = {
	symbol: string;
	benchmark: BenchmarkSymbol;
	range: Range;
};

export type ValidationResult =
	| { ok: true; canonical: Canonical }
	| { ok: false; error: string; field: 'symbol' | 'benchmark' | 'range' };

export function canonicalizeAndValidate(input: {
	symbol: string | null;
	benchmark: string | null;
	range: string | null;
}): ValidationResult {
	const rawSym = (input.symbol ?? '').trim();
	if (!rawSym) {
		return { ok: false, error: 'symbol is required', field: 'symbol' };
	}
	const symbol = rawSym.toUpperCase();
	if (!SYMBOL_RE.test(symbol)) {
		return { ok: false, error: 'symbol must match ^[A-Z^.-]{1,8}$', field: 'symbol' };
	}

	const benchInput = (input.benchmark ?? '').trim();
	const benchmark = benchInput ? benchInput.toUpperCase() : DEFAULT_BENCHMARK;
	if (!isBenchmarkSymbol(benchmark)) {
		const allowed = Object.keys(BENCHMARKS).join(', ');
		return { ok: false, error: `benchmark must be one of: ${allowed}`, field: 'benchmark' };
	}

	const rangeInput = (input.range ?? '').trim().toUpperCase();
	const range = (rangeInput || DEFAULT_RANGE) as Range;
	if (!(RANGES as ReadonlyArray<string>).includes(range)) {
		return { ok: false, error: `range must be one of: ${RANGES.join(', ')}`, field: 'range' };
	}

	return { ok: true, canonical: { symbol, benchmark, range } };
}

export function canonicalCacheKey(c: Canonical): string {
	return `${c.symbol}|${c.benchmark}|${c.range}`;
}

export function canonicalRequestUrl(base: string, c: Canonical): string {
	const u = new URL('/api/history', base);
	u.searchParams.set('symbol', c.symbol);
	u.searchParams.set('benchmark', c.benchmark);
	u.searchParams.set('range', c.range);
	return u.toString();
}
