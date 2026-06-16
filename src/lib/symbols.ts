import {
	BENCHMARKS,
	BENCHMARK_GROUP_LABELS,
	groupedBenchmarks,
	type BenchmarkEntry
} from './benchmarks.js';
import type { SeriesKind } from './providers/types.js';

/**
 * A single search/browse result. `asset` is the fine instrument class shown as
 * the disambiguating hint ("Index" / "ETF" / "Equity"); `kind` is the coarse
 * color treatment derived from it (`INDEX → index`, else `equity`). `exchange`
 * is an optional further disambiguator from the remote provider.
 */
export type SymbolSearchResult = {
	symbol: string;
	name: string;
	asset: 'EQUITY' | 'ETF' | 'INDEX';
	kind: SeriesKind;
	exchange?: string;
	currency?: string;
};

/** Derive the coarse color treatment from the fine instrument class. */
export function kindForAsset(asset: 'EQUITY' | 'ETF' | 'INDEX'): SeriesKind {
	return asset === 'INDEX' ? 'index' : 'equity';
}

type PopularTicker = { symbol: string; name: string };

/**
 * Small hand-curated seed of mega-cap tickers. Powers the browse-on-focus panel
 * and instant local matches for the most common picks; the long tail comes from
 * the debounced Yahoo proxy (`/api/search`).
 */
export const POPULAR_TICKERS: PopularTicker[] = [
	{ symbol: 'AAPL', name: 'Apple Inc.' },
	{ symbol: 'MSFT', name: 'Microsoft Corporation' },
	{ symbol: 'NVDA', name: 'NVIDIA Corporation' },
	{ symbol: 'GOOGL', name: 'Alphabet Inc. (Class A)' },
	{ symbol: 'AMZN', name: 'Amazon.com, Inc.' },
	{ symbol: 'META', name: 'Meta Platforms, Inc.' },
	{ symbol: 'TSLA', name: 'Tesla, Inc.' },
	{ symbol: 'BRK-B', name: 'Berkshire Hathaway Inc. (Class B)' },
	{ symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
	{ symbol: 'V', name: 'Visa Inc.' },
	{ symbol: 'WMT', name: 'Walmart Inc.' },
	{ symbol: 'JNJ', name: 'Johnson & Johnson' }
];

export type BrowseGroup = { group: string; entries: SymbolSearchResult[] };

function popularResult(t: PopularTicker): SymbolSearchResult {
	return { symbol: t.symbol, name: t.name, asset: 'EQUITY', kind: 'equity', currency: 'USD' };
}

function benchmarkResult(symbol: string, entry: BenchmarkEntry): SymbolSearchResult {
	return {
		symbol,
		name: entry.label,
		asset: entry.asset,
		kind: kindForAsset(entry.asset),
		currency: entry.currency
	};
}

/**
 * The discovery panel shown on focus: a Popular group followed by the curated
 * indices grouped by region. Index `asset` is read directly from BENCHMARKS
 * (not inferred from a return-basis proxy).
 */
export function buildBrowseList(): BrowseGroup[] {
	const popular: BrowseGroup = {
		group: 'Popular',
		entries: POPULAR_TICKERS.map(popularResult)
	};
	const indexGroups: BrowseGroup[] = groupedBenchmarks().map((g) => ({
		group: BENCHMARK_GROUP_LABELS[g.group],
		entries: g.entries.map(({ symbol, entry }) => benchmarkResult(symbol, entry))
	}));
	return [popular, ...indexGroups];
}

function allLocalEntries(): SymbolSearchResult[] {
	const out: SymbolSearchResult[] = POPULAR_TICKERS.map(popularResult);
	for (const [symbol, entry] of Object.entries(BENCHMARKS)) {
		out.push(benchmarkResult(symbol, entry));
	}
	return out;
}

/**
 * Instant client-side matches against the bundled set. Ranks by match quality:
 * exact symbol > symbol prefix > symbol substring > name substring.
 */
export function searchLocal(q: string): SymbolSearchResult[] {
	const needle = q.trim().toUpperCase();
	if (!needle) return [];
	const scored: Array<{ entry: SymbolSearchResult; score: number }> = [];
	for (const entry of allLocalEntries()) {
		const sym = entry.symbol.toUpperCase();
		const name = entry.name.toUpperCase();
		let score = -1;
		if (sym === needle) score = 0;
		else if (sym.startsWith(needle)) score = 1;
		else if (sym.includes(needle)) score = 2;
		else if (name.includes(needle)) score = 3;
		if (score >= 0) scored.push({ entry, score });
	}
	scored.sort((a, b) => a.score - b.score || a.entry.symbol.localeCompare(b.entry.symbol));
	return scored.map((s) => s.entry);
}

/**
 * Merge instant local matches with the debounced remote list. Deduped by symbol
 * with local entries winning (their curated labels are higher quality); local
 * matches are listed first, then remote long-tail entries not already present.
 */
export function mergeResults(
	local: SymbolSearchResult[],
	remote: SymbolSearchResult[]
): SymbolSearchResult[] {
	const bySym = new Map<string, SymbolSearchResult>();
	for (const r of remote) bySym.set(r.symbol.toUpperCase(), r);
	for (const l of local) bySym.set(l.symbol.toUpperCase(), l); // local wins on label quality

	const seen = new Set<string>();
	const out: SymbolSearchResult[] = [];
	for (const l of local) {
		const k = l.symbol.toUpperCase();
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(bySym.get(k)!);
	}
	for (const r of remote) {
		const k = r.symbol.toUpperCase();
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(bySym.get(k)!);
	}
	return out;
}
