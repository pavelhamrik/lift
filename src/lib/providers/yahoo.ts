import YahooFinance from 'yahoo-finance2';
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

const defaultClient = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const defaultFetch: FetchChart = async (symbol, opts) =>
	(await defaultClient.chart(symbol, { ...opts, return: 'array' })) as YahooChartResult;

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
