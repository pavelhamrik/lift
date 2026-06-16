import { isBenchmarkSymbol, DEFAULT_BASIS } from './benchmarks.js';
import { RANGES, type Range, type ReturnBasis } from './providers/types.js';

export const SELECTION_STORAGE_KEY = 'lift:selection';

/**
 * The unified stored/shared model: one ordered symbol list (kind is derived,
 * never stored), the user's return-basis choice, and the range. There is no
 * legacy `{ stocks, compares }` form — the app has no users yet, so the shape is
 * replaced outright rather than migrated.
 */
export type StoredSelection = {
	symbols: string[];
	basis: ReturnBasis;
	range: Range;
};

/**
 * Single combined cap (= the old MAX_STOCKS 8 + MAX_COMPARES 8 = 16, so total
 * capacity is unchanged). Declared once here and imported by the page,
 * `history-multi`, and the parsers so the cap is enforced identically at parse,
 * UI-add, and endpoint.
 */
export const MAX_SYMBOLS = 16;

/**
 * Broadened from the old letter-only `^[A-Z^.-]{1,8}$`: digits and 9+-char
 * symbols are now legal so the curated indices that carry them (`^STOXX50E`,
 * `000001.SS`, …) and any digit-bearing Yahoo ticker (`005930.KS`) round-trip
 * once everything routes through one unified field.
 */
const SYMBOL_RE = /^[A-Z0-9.^=-]{1,14}$/;

/** Accepts a symbol if it is a curated BENCHMARKS key OR matches the broadened regex. */
export function isValidSymbol(s: string): boolean {
	return isBenchmarkSymbol(s) || SYMBOL_RE.test(s);
}

export function normalizeSymbol(s: unknown): string | null {
	if (typeof s !== 'string') return null;
	const v = s.trim().toUpperCase();
	if (!v) return null;
	return isValidSymbol(v) ? v : null;
}

/**
 * Wire/storage token (`total`/`price`) ↔ internal value
 * (`total-return`/`price-only`). A single codec so the short URL token and the
 * internal value never drift. Absent or malformed → the default basis (the
 * endpoint is stricter and 400s on a malformed token; the client degrades).
 */
export function serializeBasis(basis: ReturnBasis): 'total' | 'price' {
	return basis === 'total-return' ? 'total' : 'price';
}

export function parseBasis(token: string | null | undefined): ReturnBasis {
	if (token === 'price') return 'price-only';
	if (token === 'total') return 'total-return';
	return DEFAULT_BASIS;
}

function buildSelection(
	symbolsIn: unknown[],
	basisRaw: string | null | undefined,
	rangeRaw: string
): StoredSelection | null {
	if (!(RANGES as ReadonlyArray<string>).includes(rangeRaw)) return null;
	const range = rangeRaw as Range;

	// Fixed order (Finding 5, review #3): normalize → drop invalid → dedupe (first
	// occurrence wins) → clamp. Dedupe must precede clamp so case/whitespace
	// duplicates don't consume the cap.
	const seen = new Set<string>();
	const symbols: string[] = [];
	for (const s of symbolsIn) {
		const v = normalizeSymbol(s);
		if (!v) continue;
		if (seen.has(v)) continue;
		seen.add(v);
		symbols.push(v);
	}
	if (symbols.length === 0) return null;

	return {
		symbols: symbols.slice(0, MAX_SYMBOLS),
		basis: parseBasis(basisRaw),
		range
	};
}

export function parseSelection(raw: string | null): StoredSelection | null {
	if (!raw) return null;
	try {
		const obj = JSON.parse(raw) as unknown;
		if (!obj || typeof obj !== 'object') return null;
		const o = obj as Record<string, unknown>;

		if (!Array.isArray(o.symbols)) return null;
		const rangeRaw = typeof o.range === 'string' ? o.range.trim().toUpperCase() : '';
		const basisRaw = typeof o.basis === 'string' ? o.basis : null;

		return buildSelection(o.symbols, basisRaw, rangeRaw);
	} catch {
		return null;
	}
}

export function serializeSelection(s: StoredSelection): string {
	return JSON.stringify({
		symbols: s.symbols,
		basis: serializeBasis(s.basis),
		range: s.range
	});
}

/** Load the saved selection (no legacy-key migration — there are no legacy users). */
export function loadStoredSelection(storage: Storage): StoredSelection | null {
	return parseSelection(storage.getItem(SELECTION_STORAGE_KEY));
}

/** Parse a selection from URL query params (?symbols=AAPL,MSFT&basis=total&range=1Y). */
export function parseSelectionParams(params: URLSearchParams): StoredSelection | null {
	const symbolsRaw = params.get('symbols');
	const basisRaw = params.get('basis');
	const rangeParam = params.get('range');
	if (symbolsRaw === null && basisRaw === null && rangeParam === null) return null;

	const splitCsv = (raw: string | null): string[] =>
		(raw ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

	return buildSelection(splitCsv(symbolsRaw), basisRaw, (rangeParam ?? '').trim().toUpperCase());
}

/** Encode a selection into URL query params for shareable links. */
export function selectionToSearchParams(s: StoredSelection): URLSearchParams {
	const params = new URLSearchParams();
	params.set('symbols', s.symbols.join(','));
	params.set('basis', serializeBasis(s.basis));
	params.set('range', s.range);
	return params;
}
