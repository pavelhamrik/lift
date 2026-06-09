import { describe, it, expect } from 'vitest';
import { buildResultFromChart, type YahooChartResult } from '../src/lib/providers/yahoo.js';
import { innerJoinByTime } from '../src/lib/chart/normalize.js';
import type { HistoryRequest } from '../src/lib/providers/types.js';

function chartFor(
	tz: string,
	bars: Array<{ isoLocalDate: string; close: number }>
): YahooChartResult {
	return {
		meta: {
			currency: 'USD',
			symbol: 'X',
			exchangeName: 'X',
			instrumentType: 'EQUITY',
			timezone: tz,
			exchangeTimezoneName: tz,
			regularMarketPrice: bars[bars.length - 1]?.close,
			regularMarketTime: new Date(`${bars[bars.length - 1].isoLocalDate}T00:00:00${tzOffset(tz)}`)
		},
		quotes: bars.map((b) => ({
			date: new Date(`${b.isoLocalDate}T00:00:00${tzOffset(tz)}`),
			close: b.close,
			adjclose: b.close,
			volume: 0
		}))
	};
}

function tzOffset(tz: string): string {
	if (tz === 'Asia/Tokyo') return '+09:00';
	if (tz === 'America/New_York') return '-05:00';
	return 'Z';
}

const req: HistoryRequest = {
	interval: '1d',
	session: 'regular',
	adjusted: false,
	period1: Math.floor(new Date('2024-01-01').getTime() / 1000),
	period2: Math.floor(new Date('2027-01-01').getTime() / 1000)
};
const now = new Date('2025-05-20T12:00:00Z');

describe('cross-session daily bar alignment', () => {
	it('US daily bars and Tokyo daily bars on the same calendar day inner-join', () => {
		const us = buildResultFromChart(
			chartFor('America/New_York', [
				{ isoLocalDate: '2025-05-12', close: 100 },
				{ isoLocalDate: '2025-05-13', close: 101 }
			]),
			req,
			now,
			'AAPL'
		);
		const jp = buildResultFromChart(
			chartFor('Asia/Tokyo', [
				{ isoLocalDate: '2025-05-12', close: 38000 },
				{ isoLocalDate: '2025-05-13', close: 38100 }
			]),
			req,
			now,
			'^N225'
		);
		const j = innerJoinByTime(us.bars, jp.bars);
		expect(j.target.length).toBe(2);
		expect(j.benchmark.length).toBe(2);
		expect(j.target[0].time).toBe(j.benchmark[0].time);
	});

	it('intraday bars are not normalized (kept on real timestamps)', () => {
		const intradayReq: HistoryRequest = { ...req, interval: '1m' };
		const us = buildResultFromChart(
			{
				meta: {
					currency: 'USD',
					symbol: 'X',
					exchangeName: 'NMS',
					instrumentType: 'EQUITY',
					timezone: 'America/New_York',
					exchangeTimezoneName: 'America/New_York'
				},
				quotes: [
					{ date: new Date('2025-05-12T14:30:00Z'), close: 100, volume: 0 },
					{ date: new Date('2025-05-12T14:31:00Z'), close: 100.5, volume: 0 }
				]
			},
			intradayReq,
			now,
			'AAPL'
		);
		expect(us.bars[0].time).toBe(Math.floor(new Date('2025-05-12T14:30:00Z').getTime() / 1000));
	});
});
