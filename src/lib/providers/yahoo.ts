import type {
	Asset,
	Country,
	HistoryRequest,
	HistoryResult,
	InstrumentMeta,
	Interval,
	PriceProvider,
	ProviderTrace
} from './types.js';

const US_EXCHANGES = new Set(['NMS', 'NYQ', 'NGM', 'NCM', 'PCX', 'ASE', 'BATS', 'YHD']);

export type YahooChartMeta = {
	currency?: string;
	symbol?: string;
	exchangeName?: string;
	instrumentType?: string;
	timezone?: string;
	exchangeTimezoneName?: string;
	regularMarketPrice?: number;
	regularMarketTime?: Date | number;
};

export type YahooQuote = {
	date: Date;
	close: number | null;
	adjclose?: number | null;
	volume: number | null;
};

export type YahooChartResult = {
	meta: YahooChartMeta;
	quotes: YahooQuote[];
};

export type FetchChart = (
	symbol: string,
	opts: {
		period1: Date;
		period2: Date;
		interval: Interval;
		includePrePost: boolean;
	}
) => Promise<YahooChartResult>;

// Yahoo's public chart JSON API. The v8 chart endpoint needs no crumb/cookie
// (unlike quote/quoteSummary), so a plain fetch works on the Workers runtime —
// which is why we call it directly instead of via yahoo-finance2 (that library
// pulls in @deno/shim-deno, which references the CJS global __dirname and so
// fails to even load under workerd).
const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

type YahooChartApiResponse = {
	chart?: {
		result?: Array<{
			meta?: YahooChartMeta;
			timestamp?: number[];
			indicators?: {
				quote?: Array<{ close?: (number | null)[]; volume?: (number | null)[] }>;
				adjclose?: Array<{ adjclose?: (number | null)[] }>;
			};
		}>;
		error?: { description?: string } | null;
	};
};

const defaultFetch: FetchChart = async (symbol, opts) => {
	const url = new URL(`${YAHOO_CHART_BASE}/${encodeURIComponent(symbol)}`);
	url.searchParams.set('period1', String(Math.floor(opts.period1.getTime() / 1000)));
	url.searchParams.set('period2', String(Math.floor(opts.period2.getTime() / 1000)));
	url.searchParams.set('interval', opts.interval);
	url.searchParams.set('includePrePost', opts.includePrePost ? 'true' : 'false');
	// `events=div,splits` makes Yahoo include the adjusted-close series we need
	// for total-return benchmarks.
	url.searchParams.set('events', 'div,splits');

	const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA, accept: 'application/json' } });
	if (!res.ok) throw new Error(`yahoo chart ${symbol}: HTTP ${res.status}`);

	const json = (await res.json()) as YahooChartApiResponse;
	const result = json.chart?.result?.[0];
	if (!result || !result.meta) {
		throw new Error(`yahoo chart ${symbol}: ${json.chart?.error?.description ?? 'no result'}`);
	}

	const timestamps = result.timestamp ?? [];
	const quote = result.indicators?.quote?.[0] ?? {};
	const adjclose = result.indicators?.adjclose?.[0]?.adjclose;
	const quotes: YahooQuote[] = timestamps.map((t, i) => ({
		date: new Date(t * 1000),
		close: quote.close?.[i] ?? null,
		adjclose: adjclose?.[i] ?? null,
		volume: quote.volume?.[i] ?? null
	}));

	return { meta: result.meta, quotes };
};

export function mapInstrumentMeta(m: YahooChartMeta): InstrumentMeta {
	const ex = (m.exchangeName ?? '').toUpperCase();
	const it = (m.instrumentType ?? '').toUpperCase();
	const country: Country = US_EXCHANGES.has(ex) ? 'US' : it === 'INDEX' ? 'US' : 'OTHER';
	let asset: Asset = 'OTHER';
	if (it === 'EQUITY') asset = 'EQUITY';
	else if (it === 'ETF') asset = 'ETF';
	else if (it === 'INDEX') asset = 'INDEX';
	return { country, asset };
}

const DAILY_OR_LONGER: ReadonlySet<string> = new Set(['1d', '1wk', '1mo']);

function localCalendarDateUTC(d: Date, tz: string): number {
	try {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).formatToParts(d);
		const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
		const y = Number(get('year'));
		const m = Number(get('month'));
		const day = Number(get('day'));
		if (!y || !m || !day) return Math.floor(d.getTime() / 1000);
		return Math.floor(Date.UTC(y, m - 1, day) / 1000);
	} catch {
		return Math.floor(
			Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000
		);
	}
}

export function buildResultFromChart(
	raw: YahooChartResult,
	req: HistoryRequest,
	now: Date,
	providerSymbol: string
): HistoryResult {
	const tz = raw.meta.exchangeTimezoneName ?? raw.meta.timezone ?? 'UTC';
	const normalizeDailyBars = DAILY_OR_LONGER.has(req.interval);
	const bars = raw.quotes
		.filter((q) => q.close != null && Number.isFinite(q.close))
		.map((q) => ({
			time: normalizeDailyBars
				? localCalendarDateUTC(q.date, tz)
				: Math.floor(q.date.getTime() / 1000),
			close: req.adjusted && q.adjclose != null ? q.adjclose : (q.close as number),
			volume: q.volume ?? 0
		}))
		.filter((b) => b.time >= req.period1 && b.time <= req.period2);

	const meta: InstrumentMeta = mapInstrumentMeta(raw.meta);
	const last = bars[bars.length - 1];
	const regularPrice =
		typeof raw.meta.regularMarketPrice === 'number' ? raw.meta.regularMarketPrice : last?.close;
	const regularTime = raw.meta.regularMarketTime;
	const lastPriceTime =
		regularTime instanceof Date
			? Math.floor(regularTime.getTime() / 1000)
			: typeof regularTime === 'number'
				? regularTime
				: (last?.time ?? Math.floor(now.getTime() / 1000));

	return {
		symbol: raw.meta.symbol ?? providerSymbol,
		currency: raw.meta.currency ?? 'USD',
		timezone: raw.meta.exchangeTimezoneName ?? raw.meta.timezone ?? 'America/New_York',
		interval: req.interval,
		session: req.session,
		adjusted: req.adjusted,
		meta,
		bars,
		lastPrice: regularPrice ?? 0,
		lastPriceTime
	};
}

export function makeYahooProvider(fetcher: FetchChart = defaultFetch): PriceProvider {
	return {
		name: 'yahoo',
		supports(req) {
			return ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo'].includes(req.interval);
		},
		async getHistory(symbol, req) {
			const providerSymbol = symbol;
			const now = new Date();
			const raw = await fetcher(providerSymbol, {
				period1: new Date(req.period1 * 1000),
				period2: new Date(req.period2 * 1000),
				interval: req.interval,
				includePrePost: req.session === 'extended'
			});

			const result = buildResultFromChart(raw, req, now, providerSymbol);
			const trace: ProviderTrace = { providerName: 'yahoo', providerSymbol };
			return { result, trace };
		}
	};
}
