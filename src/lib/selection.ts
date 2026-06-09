import { isBenchmarkSymbol, type BenchmarkSymbol } from './benchmarks.js';
import { RANGES, type Range } from './providers/types.js';

export const SELECTION_STORAGE_KEY = 'stock-compare:selection';

export type StoredSelection = {
	stocks: string[];
	compares: BenchmarkSymbol[];
	range: Range;
};

const SYMBOL_RE = /^[A-Z\^.\-]{1,8}$/;

function normalizeSymbol(s: unknown): string | null {
	if (typeof s !== 'string') return null;
	const v = s.trim().toUpperCase();
	return SYMBOL_RE.test(v) ? v : null;
}

function dedupe<T>(arr: T[]): T[] {
	const seen = new Set<T>();
	const out: T[] = [];
	for (const v of arr) {
		if (seen.has(v)) continue;
		seen.add(v);
		out.push(v);
	}
	return out;
}

export function parseSelection(raw: string | null): StoredSelection | null {
	if (!raw) return null;
	try {
		const obj = JSON.parse(raw) as unknown;
		if (!obj || typeof obj !== 'object') return null;
		const o = obj as Record<string, unknown>;

		const rangeRaw = typeof o.range === 'string' ? o.range.trim().toUpperCase() : '';
		if (!(RANGES as ReadonlyArray<string>).includes(rangeRaw)) return null;
		const range = rangeRaw as Range;

		let stocksIn: unknown[] = [];
		let comparesIn: unknown[] = [];

		if (Array.isArray(o.stocks) || Array.isArray(o.compares)) {
			stocksIn = Array.isArray(o.stocks) ? o.stocks : [];
			comparesIn = Array.isArray(o.compares) ? o.compares : [];
		} else if (typeof o.symbol === 'string' || typeof o.benchmark === 'string') {
			// Legacy single-pair shape.
			if (typeof o.symbol === 'string') stocksIn = [o.symbol];
			if (typeof o.benchmark === 'string') comparesIn = [o.benchmark];
		} else {
			return null;
		}

		const stocks: string[] = [];
		for (const s of stocksIn) {
			const v = normalizeSymbol(s);
			if (v) stocks.push(v);
		}
		const compares: BenchmarkSymbol[] = [];
		for (const c of comparesIn) {
			if (typeof c !== 'string') continue;
			const v = c.trim().toUpperCase();
			if (isBenchmarkSymbol(v)) compares.push(v);
		}

		if (stocks.length === 0) return null;

		return {
			stocks: dedupe(stocks),
			compares: dedupe(compares),
			range
		};
	} catch {
		return null;
	}
}

export function serializeSelection(s: StoredSelection): string {
	return JSON.stringify({ stocks: s.stocks, compares: s.compares, range: s.range });
}
