import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildResultFromChart,
	mapInstrumentMeta,
	type YahooChartResult
} from '../../src/lib/providers/yahoo.js';
import type { HistoryRequest, HistoryResult } from '../../src/lib/providers/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, 'fixtures');

type FixtureSpec = {
	symbol: string;
	expectedAsset: 'US_LISTED_EQUITY' | 'US_LISTED_ETF' | 'US_INDEX';
	rationale: string;
};

const SPECS: FixtureSpec[] = [
	{ symbol: '^GSPC', expectedAsset: 'US_INDEX', rationale: 'index benchmark, price-only policy' },
	{ symbol: 'SPY', expectedAsset: 'US_LISTED_ETF', rationale: 'ETF benchmark, total-return policy' },
	{ symbol: 'AAPL', expectedAsset: 'US_LISTED_EQUITY', rationale: 'plain US equity, splits + dividends' },
	{
		symbol: 'BRK.B',
		expectedAsset: 'US_LISTED_EQUITY',
		rationale: 'dotted-class share — exercises symbol-normalization path the regex admits'
	}
];

function syntheticChart(symbol: string): YahooChartResult {
	const isIndex = symbol === '^GSPC';
	const isETF = symbol === 'SPY';
	const base = symbol === 'AAPL' ? 150 : symbol === 'BRK.B' ? 380 : symbol === 'SPY' ? 500 : 4800;
	const quotes = Array.from({ length: 252 }, (_, i) => {
		const t = Date.UTC(2025, 4, 12) + i * 24 * 3600 * 1000;
		const drift = Math.sin(i / 17) * (base * 0.02) + i * (base * 0.0003);
		const close = base + drift;
		return {
			date: new Date(t),
			open: close - 0.5,
			high: close + 1,
			low: close - 1,
			close,
			adjclose: isIndex ? close : close * 0.985,
			volume: isIndex ? 0 : 1_000_000 + i * 1000
		};
	});
	return {
		meta: {
			currency: 'USD',
			symbol,
			exchangeName: isIndex ? 'SNP' : 'NMS',
			instrumentType: isIndex ? 'INDEX' : isETF ? 'ETF' : 'EQUITY',
			timezone: 'EDT',
			exchangeTimezoneName: 'America/New_York',
			regularMarketPrice: quotes[quotes.length - 1].close,
			regularMarketTime: quotes[quotes.length - 1].date
		},
		quotes
	};
}

function loadFixture(symbol: string): YahooChartResult {
	const safe = symbol.replace(/[^A-Z0-9.\-^]/gi, '_');
	const p = path.join(FIXTURE_DIR, `${safe}.json`);
	if (fs.existsSync(p)) {
		const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
		return reviveDates(raw) as YahooChartResult;
	}
	return syntheticChart(symbol);
}

function reviveDates(o: unknown): unknown {
	if (Array.isArray(o)) return o.map(reviveDates);
	if (o && typeof o === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
			if ((k === 'date' || k === 'regularMarketTime') && typeof v === 'string') {
				out[k] = new Date(v);
			} else {
				out[k] = reviveDates(v);
			}
		}
		return out;
	}
	return o;
}

function fixedNow(): Date {
	return new Date(Date.UTC(2026, 4, 18));
}

describe('provider contract (offline, blocking)', () => {
	for (const spec of SPECS) {
		describe(`${spec.symbol} — ${spec.rationale}`, () => {
			const raw = loadFixture(spec.symbol);
			const req: HistoryRequest = { interval: '1d', session: 'regular', adjusted: false };
			let res: HistoryResult;

			it('produces canonical HistoryResult shape', () => {
				res = buildResultFromChart(raw, req, fixedNow(), spec.symbol);
				expect(res.symbol).toBe(spec.symbol);
				expect(typeof res.currency).toBe('string');
				expect(typeof res.timezone).toBe('string');
				expect(res.interval).toBe('1d');
				expect(res.session).toBe('regular');
				expect(res.adjusted).toBe(false);
				expect(Array.isArray(res.bars)).toBe(true);
				expect(res.bars.length).toBeGreaterThan(0);
			});

			it('translates instrumentType to canonical InstrumentMeta', () => {
				const meta = mapInstrumentMeta(raw.meta);
				expect(meta.asset).toBe(spec.expectedAsset);
				expect(meta.country).toBe('US');
			});

			it('timestamps are strictly monotonic across the full series', () => {
				const out = buildResultFromChart(raw, req, fixedNow(), spec.symbol);
				for (let i = 1; i < out.bars.length; i++) {
					expect(out.bars[i].time).toBeGreaterThan(out.bars[i - 1].time);
				}
			});

			it('no NaN/null closes in mapped bars', () => {
				const out = buildResultFromChart(raw, req, fixedNow(), spec.symbol);
				for (const b of out.bars) {
					expect(Number.isFinite(b.close)).toBe(true);
				}
			});

			it('adjusted=true selects adjclose when present', () => {
				const r1 = buildResultFromChart(
					raw,
					{ interval: '1d', session: 'regular', adjusted: true },
					fixedNow(),
					spec.symbol
				);
				const r2 = buildResultFromChart(raw, req, fixedNow(), spec.symbol);
				if (spec.symbol === '^GSPC') {
					expect(r1.bars[0].close).toBeCloseTo(r2.bars[0].close, 9);
				} else {
					expect(r1.bars[0].close).not.toBe(r2.bars[0].close);
				}
			});

			it('paired target+benchmark fetches with same HistoryRequest produce same interval/session/adjusted', () => {
				const t = buildResultFromChart(raw, req, fixedNow(), spec.symbol);
				const b = buildResultFromChart(loadFixture('SPY'), req, fixedNow(), 'SPY');
				expect(t.interval).toBe(b.interval);
				expect(t.session).toBe(b.session);
				expect(t.adjusted).toBe(b.adjusted);
			});

			it('lastPrice / lastPriceTime are populated', () => {
				const out = buildResultFromChart(raw, req, fixedNow(), spec.symbol);
				expect(out.lastPrice).toBeGreaterThan(0);
				expect(out.lastPriceTime).toBeGreaterThan(0);
			});
		});
	}
});
