import YahooFinance from 'yahoo-finance2';
import type {
	Asset,
	Country,
	HistoryRequest,
	HistoryResult,
	InstrumentMeta,
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
		interval: '1m' | '5m' | '1d';
		includePrePost: boolean;
	}
) => Promise<YahooChartResult>;

const defaultClient = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const defaultFetch: FetchChart = async (symbol, opts) =>
	(await defaultClient.chart(symbol, { ...opts, return: 'array' })) as YahooChartResult;

export function mapInstrumentMeta(m: YahooChartMeta): InstrumentMeta {
	const ex = (m.exchangeName ?? '').toUpperCase();
	const it = (m.instrumentType ?? '').toUpperCase();
	const country: Country = US_EXCHANGES.has(ex) ? 'US' : it === 'INDEX' ? 'US' : 'OTHER';
	let asset: Asset = 'OTHER';
	if (it === 'EQUITY') asset = 'US_LISTED_EQUITY';
	else if (it === 'ETF') asset = 'US_LISTED_ETF';
	else if (it === 'INDEX') asset = 'US_INDEX';
	if (asset !== 'US_INDEX' && country !== 'US') {
		return { country: 'OTHER', asset: 'OTHER' };
	}
	return { country, asset };
}

function windowStart(now: Date, interval: '1m' | '5m' | '1d'): Date {
	const d = new Date(now);
	if (interval === '1d') {
		d.setUTCFullYear(d.getUTCFullYear() - 1);
		d.setUTCDate(d.getUTCDate() - 5);
		return d;
	}
	d.setUTCDate(d.getUTCDate() - 5);
	return d;
}

export function buildResultFromChart(
	raw: YahooChartResult,
	req: HistoryRequest,
	now: Date,
	providerSymbol: string
): HistoryResult {
	const trimmed =
		req.interval === '1d' ? trimToOneYear(raw.quotes, now) : trimToToday(raw.quotes, now);
	const bars = trimmed
		.filter((q) => q.close != null && Number.isFinite(q.close))
		.map((q) => ({
			time: Math.floor(q.date.getTime() / 1000),
			close: req.adjusted && q.adjclose != null ? q.adjclose : (q.close as number),
			volume: q.volume ?? 0
		}));

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
			return ['1m', '5m', '1d'].includes(req.interval);
		},
		async getHistory(symbol, req) {
			const providerSymbol = symbol;
			const now = new Date();
			const period1 = windowStart(now, req.interval);
			const raw = await fetcher(providerSymbol, {
				period1,
				period2: now,
				interval: req.interval,
				includePrePost: req.session === 'extended'
			});

			const result = buildResultFromChart(raw, req, now, providerSymbol);
			const trace: ProviderTrace = { providerName: 'yahoo', providerSymbol };
			return { result, trace };
		}
	};
}

function trimToToday(quotes: YahooQuote[], now: Date): YahooQuote[] {
	const dayStartUtc =
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86_400_000;
	return quotes.filter((q) => q.date.getTime() >= dayStartUtc);
}

function trimToOneYear(quotes: YahooQuote[], now: Date): YahooQuote[] {
	const cutoff = new Date(now);
	cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
	return quotes.filter((q) => q.date.getTime() >= cutoff.getTime());
}
