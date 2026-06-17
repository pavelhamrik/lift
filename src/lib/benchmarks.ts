import type { Interval, Range, ReturnBasis } from './providers/types.js';

export type BenchmarkGroup = 'US' | 'Europe' | 'Global' | 'APAC';

export type BenchmarkEntry = {
	label: string;
	/**
	 * Explicit instrument type — the real classification, not inferred from a
	 * return-basis proxy. Drives provisional `kind` (INDEX → index, ETF → equity)
	 * and the fixture provider's metadata.
	 */
	asset: 'INDEX' | 'ETF';
	group: BenchmarkGroup;
	currency: string;
};

export const BENCHMARKS = {
	// US
	'^GSPC': { label: 'S&P 500 index (^GSPC)', asset: 'INDEX', group: 'US', currency: 'USD' },
	SPY: { label: 'S&P 500 ETF (SPY)', asset: 'ETF', group: 'US', currency: 'USD' },
	'^IXIC': {
		label: 'Nasdaq Composite (^IXIC)',
		asset: 'INDEX',
		group: 'US',
		currency: 'USD'
	},
	'^NDX': { label: 'Nasdaq-100 index (^NDX)', asset: 'INDEX', group: 'US', currency: 'USD' },
	QQQ: { label: 'Nasdaq-100 ETF (QQQ)', asset: 'ETF', group: 'US', currency: 'USD' },
	'^RUT': { label: 'Russell 2000 index (^RUT)', asset: 'INDEX', group: 'US', currency: 'USD' },
	IWM: { label: 'Russell 2000 ETF (IWM)', asset: 'ETF', group: 'US', currency: 'USD' },

	// Europe
	'^FTSE': { label: 'FTSE 100 (^FTSE)', asset: 'INDEX', group: 'Europe', currency: 'GBP' },
	'^GDAXI': { label: 'DAX (^GDAXI)', asset: 'INDEX', group: 'Europe', currency: 'EUR' },
	'^FCHI': { label: 'CAC 40 (^FCHI)', asset: 'INDEX', group: 'Europe', currency: 'EUR' },
	'^STOXX50E': {
		label: 'Euro Stoxx 50 (^STOXX50E)',
		asset: 'INDEX',
		group: 'Europe',
		currency: 'EUR'
	},
	'^STOXX': {
		label: 'Stoxx Europe 600 (^STOXX)',
		asset: 'INDEX',
		group: 'Europe',
		currency: 'EUR'
	},

	// Global — USD-listed ETF proxies for MSCI indices (raw MSCI tickers have spotty Yahoo coverage)
	URTH: {
		label: 'MSCI World ETF (URTH)',
		asset: 'ETF',
		group: 'Global',
		currency: 'USD'
	},
	EEM: {
		label: 'MSCI Emerging Markets ETF (EEM)',
		asset: 'ETF',
		group: 'Global',
		currency: 'USD'
	},
	ACWI: {
		label: 'MSCI ACWI ETF (ACWI)',
		asset: 'ETF',
		group: 'Global',
		currency: 'USD'
	},

	// APAC
	'^N225': { label: 'Nikkei 225 (^N225)', asset: 'INDEX', group: 'APAC', currency: 'JPY' },
	'^HSI': { label: 'Hang Seng (^HSI)', asset: 'INDEX', group: 'APAC', currency: 'HKD' },
	'000001.SS': {
		label: 'Shanghai Composite (000001.SS)',
		asset: 'INDEX',
		group: 'APAC',
		currency: 'CNY'
	},
	'000300.SS': {
		label: 'CSI 300 (000300.SS)',
		asset: 'INDEX',
		group: 'APAC',
		currency: 'CNY'
	},
	'^KS11': { label: 'KOSPI (^KS11)', asset: 'INDEX', group: 'APAC', currency: 'KRW' }
} as const satisfies Record<string, BenchmarkEntry>;

export type BenchmarkSymbol = keyof typeof BENCHMARKS;

export const BENCHMARK_GROUP_ORDER: BenchmarkGroup[] = ['US', 'Europe', 'APAC', 'Global'];

export const BENCHMARK_GROUP_LABELS: Record<BenchmarkGroup, string> = {
	US: 'United States',
	Europe: 'Europe',
	Global: 'Global',
	APAC: 'Asia-Pacific'
};

/** Default unified selection: two equities + one ETF proxy. */
export const DEFAULT_SYMBOLS: string[] = ['AAPL', 'TSLA', 'SPY'];
export const DEFAULT_BASIS: ReturnBasis = 'total-return';
export const DEFAULT_RANGE: Range = '1Y';

export function isBenchmarkSymbol(s: string): s is BenchmarkSymbol {
	return Object.prototype.hasOwnProperty.call(BENCHMARKS, s);
}

export function isIntradayRange(range: Range): boolean {
	return range === '1D' || range === '5D';
}

export function intervalForRange(range: Range): Interval {
	switch (range) {
		case '1D':
			return '1m';
		case '5D':
			return '5m';
		case '1M':
		case '6M':
		case 'YTD':
		case '1Y':
			return '1d';
		case '5Y':
			return '1wk';
		case 'MAX':
			return '1mo';
	}
}

export function periodForRange(range: Range, now: Date): { period1: number; period2: number } {
	const p2 = Math.floor(now.getTime() / 1000);
	const d = new Date(now);
	switch (range) {
		case '1D':
			d.setUTCDate(d.getUTCDate() - 2);
			break;
		case '5D':
			d.setUTCDate(d.getUTCDate() - 9);
			break;
		case '1M':
			d.setUTCMonth(d.getUTCMonth() - 1);
			break;
		case '6M':
			d.setUTCMonth(d.getUTCMonth() - 6);
			break;
		case 'YTD':
			return {
				period1: Math.floor(Date.UTC(now.getUTCFullYear(), 0, 1) / 1000),
				period2: p2
			};
		case '1Y':
			d.setUTCFullYear(d.getUTCFullYear() - 1);
			break;
		case '5Y':
			d.setUTCFullYear(d.getUTCFullYear() - 5);
			break;
		case 'MAX':
			return { period1: 0, period2: p2 };
	}
	return { period1: Math.floor(d.getTime() / 1000), period2: p2 };
}

export function groupedBenchmarks(): Array<{
	group: BenchmarkGroup;
	entries: Array<{ symbol: BenchmarkSymbol; entry: BenchmarkEntry }>;
}> {
	const groups: Record<
		BenchmarkGroup,
		Array<{ symbol: BenchmarkSymbol; entry: BenchmarkEntry }>
	> = { US: [], Europe: [], Global: [], APAC: [] };
	for (const [symbol, entry] of Object.entries(BENCHMARKS) as Array<
		[BenchmarkSymbol, BenchmarkEntry]
	>) {
		groups[entry.group].push({ symbol, entry });
	}
	return BENCHMARK_GROUP_ORDER.map((g) => ({ group: g, entries: groups[g] }));
}
