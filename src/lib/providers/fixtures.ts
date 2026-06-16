import { BENCHMARKS, isBenchmarkSymbol, type BenchmarkSymbol } from '$lib/benchmarks.js';
import { makeYahooProvider, type FetchChart, type YahooQuote } from './yahoo.js';
import type { Interval, PriceProvider } from './types.js';

// Unique sentinel string. Build verification greps the generated Worker bundle
// (`.svelte-kit/cloudflare/_worker.js`) for this marker and fails if present —
// proving this whole module is tree-shaken out of the production build (the
// only static reference to `fixtureFetch` lives behind an `import.meta.env.DEV`
// literal in providers/index.ts, so Rollup drops it). The marker is referenced
// inside `fixtureFetch` below so it can't be independently dropped while the
// fetcher survives.
export const FIXTURE_BUILD_MARKER = 'LIFT_FIXTURE_BUILD_MARKER_7c3f9a21';

// ---------------------------------------------------------------------------
// Per-symbol metadata — explicit, not heuristic.
//
// A "`^…` → index, else equity" heuristic mislabels the non-`^` index
// benchmarks 000001.SS / 000300.SS as US equities. Instead we drive metadata
// from an explicit table covering every BENCHMARKS entry: currency + the
// explicit `asset` (INDEX/ETF) come from BENCHMARKS — the .SS pair is declared
// INDEX there — and exchange/timezone is assigned here. Unknown (user-typed)
// symbols fall back to the generic US-equity default.
// ---------------------------------------------------------------------------

type FixtureMeta = {
	instrumentType: 'INDEX' | 'ETF' | 'EQUITY';
	exchangeName: string;
	currency: string;
	exchangeTimezoneName: string;
};

const EXCHANGE_BY_SYMBOL = {
	// US — all America/New_York
	'^GSPC': { exchangeName: 'SNP', tz: 'America/New_York' },
	SPY: { exchangeName: 'PCX', tz: 'America/New_York' },
	'^IXIC': { exchangeName: 'NIM', tz: 'America/New_York' },
	'^NDX': { exchangeName: 'NIM', tz: 'America/New_York' },
	QQQ: { exchangeName: 'NMS', tz: 'America/New_York' },
	'^RUT': { exchangeName: 'WCB', tz: 'America/New_York' },
	IWM: { exchangeName: 'PCX', tz: 'America/New_York' },

	// Europe
	'^FTSE': { exchangeName: 'FGI', tz: 'Europe/London' },
	'^GDAXI': { exchangeName: 'GER', tz: 'Europe/Berlin' },
	'^FCHI': { exchangeName: 'PAR', tz: 'Europe/Paris' },
	'^STOXX50E': { exchangeName: 'STO', tz: 'Europe/Berlin' },
	'^STOXX': { exchangeName: 'STO', tz: 'Europe/Zurich' },

	// Global — USD-listed US ETF proxies
	URTH: { exchangeName: 'PCX', tz: 'America/New_York' },
	EEM: { exchangeName: 'PCX', tz: 'America/New_York' },
	ACWI: { exchangeName: 'NMS', tz: 'America/New_York' },

	// APAC
	'^N225': { exchangeName: 'OSA', tz: 'Asia/Tokyo' },
	'^HSI': { exchangeName: 'HKG', tz: 'Asia/Hong_Kong' },
	'000001.SS': { exchangeName: 'SHH', tz: 'Asia/Shanghai' },
	'000300.SS': { exchangeName: 'SHH', tz: 'Asia/Shanghai' },
	'^KS11': { exchangeName: 'KSC', tz: 'Asia/Seoul' }
} as const satisfies Record<BenchmarkSymbol, { exchangeName: string; tz: string }>;

const DEFAULT_META: FixtureMeta = {
	instrumentType: 'EQUITY',
	exchangeName: 'NMS',
	currency: 'USD',
	exchangeTimezoneName: 'America/New_York'
};

function metaFor(symbol: string): FixtureMeta {
	if (isBenchmarkSymbol(symbol)) {
		const b = BENCHMARKS[symbol];
		const ex = EXCHANGE_BY_SYMBOL[symbol];
		return {
			instrumentType: b.asset,
			exchangeName: ex.exchangeName,
			currency: b.currency,
			exchangeTimezoneName: ex.tz
		};
	}
	return DEFAULT_META;
}

// Weekday exchange sessions, in local wall-clock minutes-from-midnight, keyed
// by IANA timezone. Drives the intraday grid so bars only fall inside each
// symbol's own session — keeping payloads ~10x smaller than a 24/7 grid and
// preserving the documented non-overlap of cross-market intraday comparisons.
const SESSION_HOURS: Record<string, { openMin: number; closeMin: number }> = {
	'America/New_York': { openMin: 9 * 60 + 30, closeMin: 16 * 60 },
	'Europe/London': { openMin: 8 * 60, closeMin: 16 * 60 + 30 },
	'Europe/Berlin': { openMin: 9 * 60, closeMin: 17 * 60 + 30 },
	'Europe/Paris': { openMin: 9 * 60, closeMin: 17 * 60 + 30 },
	'Europe/Zurich': { openMin: 9 * 60, closeMin: 17 * 60 + 30 },
	'Asia/Tokyo': { openMin: 9 * 60, closeMin: 15 * 60 },
	'Asia/Hong_Kong': { openMin: 9 * 60 + 30, closeMin: 16 * 60 },
	'Asia/Shanghai': { openMin: 9 * 60 + 30, closeMin: 15 * 60 },
	'Asia/Seoul': { openMin: 9 * 60, closeMin: 15 * 60 + 30 }
};
// A direct literal (not `SESSION_HOURS['America/New_York']`): a top-level
// computed member access is treated as a possible side effect by Rollup and
// would survive dead-code elimination, leaking a fragment of this module into
// the prod bundle. Keeping SESSION_HOURS referenced only inside generateGrid
// lets the whole module tree-shake out cleanly.
const DEFAULT_SESSION = { openMin: 9 * 60 + 30, closeMin: 16 * 60 }; // US session

// ---------------------------------------------------------------------------
// Deterministic curve — log-price, anchored to absolute time.
//
// Raw `close` is a pure function of (symbol, absolute unix timestamp), NOT of
// bar-index within the requested window, so any two requests overlapping in
// time return identical raw closes on shared timestamps. A bounded log-price
// form keeps prices strictly positive and finite even over MAX (period1 = 0,
// the Unix epoch), where a linear curve could cross zero.
// ---------------------------------------------------------------------------

const EPOCH_MS = Date.UTC(1990, 0, 1); // fixed, safely before any period1
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

const INTRADAY_STEP_SEC: Partial<Record<Interval, number>> = {
	'1m': 60,
	'5m': 300,
	'15m': 900,
	'30m': 1800,
	'1h': 3600
};

type Params = {
	base: number;
	growth: number;
	yieldRate: number;
	a1: number;
	a2: number;
	a3: number;
	f1: number;
	f2: number;
	f3: number;
	ph1: number;
	ph2: number;
	ph3: number;
	baseVol: number;
};

function hashStr(s: string): number {
	let h = 2166136261 >>> 0; // FNV-1a
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function deriveParams(symbol: string): Params {
	const rnd = mulberry32(hashStr(symbol));
	const base = 20 + rnd() * 480; // [20, 500]
	const growth = 0.02 + rnd() * 0.1; // [2%, 12%] annualized log-growth
	const yieldRate = 0.005 + rnd() * 0.03; // [0.5%, 3.5%] dividend-style drag
	// Bounded wave amplitudes: max sum 0.20 + 0.10 + 0.06 = 0.36, so the wave
	// term lives in [-0.36, 0.36] and exp(...) stays finite and positive.
	const a1 = 0.1 + rnd() * 0.1;
	const a2 = 0.04 + rnd() * 0.06;
	const a3 = 0.02 + rnd() * 0.04;
	const f1 = 0.3 + rnd() * 0.7; // cycles/year
	const f2 = 1.0 + rnd() * 2.0;
	const f3 = 3.0 + rnd() * 5.0;
	const ph1 = rnd() * 2 * Math.PI;
	const ph2 = rnd() * 2 * Math.PI;
	const ph3 = rnd() * 2 * Math.PI;
	const baseVol = 5e5 + rnd() * 5e6;
	return { base, growth, yieldRate, a1, a2, a3, f1, f2, f3, ph1, ph2, ph3, baseVol };
}

function closePrice(p: Params, tSec: number): number {
	const years = (tSec * 1000 - EPOCH_MS) / MS_PER_YEAR;
	const waves =
		p.a1 * Math.sin(2 * Math.PI * years * p.f1 + p.ph1) +
		p.a2 * Math.sin(2 * Math.PI * years * p.f2 + p.ph2) +
		p.a3 * Math.sin(2 * Math.PI * years * p.f3 + p.ph3);
	return p.base * Math.exp(p.growth * years + waves);
}

// Cumulative dividend-style adjustment with an explicit as-of date (the
// request's own UTC day-end upper bound). For t <= asOf, yearsBetween >= 0, so
// 0 <= adjFactor <= 1 and adjFactor -> 1 at the window's latest bar. A constant
// multiplier would cancel under pctChangeSeries (which re-bases to the first
// point), so adjusted vs unadjusted curves must diverge over the window.
function adjFactor(p: Params, tSec: number, asOfMs: number): number {
	const years = Math.max(0, (asOfMs - tSec * 1000) / MS_PER_YEAR);
	return 1 / (1 + p.yieldRate * years);
}

function volumeFor(p: Params, tSec: number): number {
	const years = (tSec * 1000 - EPOCH_MS) / MS_PER_YEAR;
	const wiggle = 1 + 0.4 * Math.sin(2 * Math.PI * years * 12 + p.ph1);
	return Math.max(1, Math.round(p.baseVol * wiggle));
}

// ---------------------------------------------------------------------------
// Timezone helpers (no external lib). Use Intl to read a UTC instant's local
// wall-clock parts, and to convert a local wall-clock time back to UTC. The
// one-step offset approximation can be off by an hour for sub-day windows
// straddling a DST transition — acceptable for synthetic fixtures.
// ---------------------------------------------------------------------------

function partsInTz(
	utcMs: number,
	tz: string
): { y: number; mo: number; d: number; h: number; mi: number } {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
	const parts = dtf.formatToParts(new Date(utcMs));
	const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
	let h = get('hour');
	if (h === 24) h = 0; // some runtimes render midnight as "24"
	return { y: get('year'), mo: get('month'), d: get('day'), h, mi: get('minute') };
}

function tzOffsetMs(utcMs: number, tz: string): number {
	const p = partsInTz(utcMs, tz);
	return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - utcMs;
}

function zonedToUtcMs(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
	const guess = Date.UTC(y, mo - 1, d, h, mi);
	return guess - tzOffsetMs(guess, tz);
}

function startOfUtcDay(ms: number): number {
	const d = new Date(ms);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function asOfDayEndMs(period2: Date): number {
	return startOfUtcDay(period2.getTime()) + DAY_MS; // ceil to UTC day end
}

// ---------------------------------------------------------------------------
// Timestamp grids — derived from (period, interval, session), so symbols that
// share a session align on identical timestamps.
// ---------------------------------------------------------------------------

function intradayGrid(
	period1: Date,
	period2: Date,
	stepSec: number,
	session: { openMin: number; closeMin: number },
	tz: string
): number[] {
	const p1 = period1.getTime();
	const p2 = period2.getTime();
	const stepMs = stepSec * 1000;
	const out: number[] = [];
	const seenDay = new Set<string>();
	for (let dayMs = startOfUtcDay(p1) - DAY_MS; dayMs <= p2 + DAY_MS; dayMs += DAY_MS) {
		const lp = partsInTz(dayMs, tz);
		const key = `${lp.y}-${lp.mo}-${lp.d}`;
		if (seenDay.has(key)) continue;
		seenDay.add(key);
		const dow = new Date(Date.UTC(lp.y, lp.mo - 1, lp.d)).getUTCDay();
		if (dow === 0 || dow === 6) continue; // weekend
		const openMs = zonedToUtcMs(
			lp.y,
			lp.mo,
			lp.d,
			Math.floor(session.openMin / 60),
			session.openMin % 60,
			tz
		);
		const closeMs = zonedToUtcMs(
			lp.y,
			lp.mo,
			lp.d,
			Math.floor(session.closeMin / 60),
			session.closeMin % 60,
			tz
		);
		for (let ts = openMs; ts < closeMs; ts += stepMs) {
			if (ts >= p1 && ts <= p2) out.push(Math.floor(ts / 1000));
		}
	}
	out.sort((a, b) => a - b);
	return out;
}

// Daily bars dated at UTC noon (safe across all our exchange offsets, so the
// bar's exchange-local calendar date matches its UTC date — which is how
// buildResultFromChart normalizes daily-and-longer bars).
function dailyGrid(period1: Date, period2: Date): number[] {
	const out: number[] = [];
	const end = period2.getTime();
	const start = period1.getTime();
	for (let day = startOfUtcDay(start); day <= end; day += DAY_MS) {
		const dow = new Date(day).getUTCDay();
		if (dow === 0 || dow === 6) continue;
		const ts = day + 12 * 3600 * 1000;
		if (ts >= start && ts <= end) out.push(Math.floor(ts / 1000));
	}
	return out;
}

// Weekly bars: Mondays at UTC noon.
function weeklyGrid(period1: Date, period2: Date): number[] {
	const out: number[] = [];
	const start = period1.getTime();
	const end = period2.getTime();
	let day = startOfUtcDay(start);
	while (new Date(day).getUTCDay() !== 1) day += DAY_MS; // advance to Monday
	for (; day + 12 * 3600 * 1000 <= end; day += 7 * DAY_MS) {
		const ts = day + 12 * 3600 * 1000;
		if (ts >= start) out.push(Math.floor(ts / 1000));
	}
	return out;
}

// Monthly bars: 1st of each month at UTC noon.
function monthlyGrid(period1: Date, period2: Date): number[] {
	const out: number[] = [];
	const start = period1.getTime();
	const end = period2.getTime();
	const d0 = new Date(start);
	let y = d0.getUTCFullYear();
	let mo = d0.getUTCMonth();
	for (;;) {
		const ts = Date.UTC(y, mo, 1, 12);
		if (ts > end) break;
		if (ts >= start) out.push(Math.floor(ts / 1000));
		if (++mo > 11) {
			mo = 0;
			y++;
		}
	}
	return out;
}

function generateGrid(
	opts: { period1: Date; period2: Date; interval: Interval },
	meta: FixtureMeta
): number[] {
	switch (opts.interval) {
		case '1d':
			return dailyGrid(opts.period1, opts.period2);
		case '1wk':
			return weeklyGrid(opts.period1, opts.period2);
		case '1mo':
			return monthlyGrid(opts.period1, opts.period2);
		default: {
			const step = INTRADAY_STEP_SEC[opts.interval] ?? 60;
			const session = SESSION_HOURS[meta.exchangeTimezoneName] ?? DEFAULT_SESSION;
			return intradayGrid(opts.period1, opts.period2, step, session, meta.exchangeTimezoneName);
		}
	}
}

/**
 * Synthetic raw fetcher. Fed into the real `makeYahooProvider(fetcher)`, so
 * only the upstream bytes are fake — all downstream windowing, adjclose
 * selection, volume, and scope mapping run the real code path.
 */
export const fixtureFetch: FetchChart = async (symbol, opts) => {
	// Keep FIXTURE_BUILD_MARKER reachable from the fetcher so the prod-bundle
	// exclusion grep is meaningful (a real symbol never equals it).
	if (symbol === FIXTURE_BUILD_MARKER) return { meta: {}, quotes: [] };

	const fm = metaFor(symbol);
	const p = deriveParams(symbol);
	const asOfMs = asOfDayEndMs(opts.period2);
	const isIndex = fm.instrumentType === 'INDEX';
	const grid = generateGrid(opts, fm);

	const quotes: YahooQuote[] = grid.map((tSec) => {
		const close = closePrice(p, tSec);
		return {
			date: new Date(tSec * 1000),
			close,
			adjclose: isIndex ? close : close * adjFactor(p, tSec, asOfMs),
			volume: isIndex ? 0 : volumeFor(p, tSec)
		};
	});

	const last = quotes[quotes.length - 1];
	return {
		meta: {
			currency: fm.currency,
			symbol,
			exchangeName: fm.exchangeName,
			instrumentType: fm.instrumentType,
			timezone: fm.exchangeTimezoneName,
			exchangeTimezoneName: fm.exchangeTimezoneName,
			regularMarketPrice: last?.close ?? undefined,
			regularMarketTime: last?.date
		},
		quotes
	};
};

export const makeFixtureProvider = (): PriceProvider => makeYahooProvider(fixtureFetch);
