export type Range = '1D' | '1Y';
export type Interval = '1m' | '5m' | '1d';
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
};

export type Country = 'US' | 'OTHER';
export type Asset = 'US_LISTED_EQUITY' | 'US_LISTED_ETF' | 'US_INDEX' | 'OTHER';

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
