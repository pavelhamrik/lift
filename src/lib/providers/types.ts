export const RANGES = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'MAX'] as const;
export type Range = (typeof RANGES)[number];

export type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk' | '1mo';
export type SessionPolicy = 'regular' | 'extended';

export type Bar = {
	time: number;
	close: number;
	volume: number;
};

export type HistoryRequest = {
	interval: Interval;
	session: SessionPolicy;
	adjusted: boolean;
	period1: number;
	period2: number;
};

export type Country = 'US' | 'OTHER';
export type Asset = 'EQUITY' | 'ETF' | 'INDEX' | 'OTHER';

export type InstrumentMeta = {
	country: Country;
	asset: Asset;
};

export type HistoryResult = {
	symbol: string;
	currency: string;
	timezone: string;
	interval: Interval;
	session: SessionPolicy;
	adjusted: boolean;
	meta: InstrumentMeta;
	bars: Bar[];
	lastPrice: number;
	lastPriceTime: number;
};

export type ProviderTrace = {
	providerName: string;
	providerSymbol: string;
};

export interface PriceProvider {
	name: string;
	getHistory(
		symbol: string,
		req: HistoryRequest
	): Promise<{ result: HistoryResult; trace: ProviderTrace }>;
	supports(req: HistoryRequest): boolean;
}
