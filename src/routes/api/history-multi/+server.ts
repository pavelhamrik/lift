import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LRUCache } from '$lib/server/cache.js';
import { SlidingWindowThrottle } from '$lib/server/throttle.js';
import { checkEdgeRateLimit } from '$lib/server/ratelimit.js';
import { isTargetInScope } from '$lib/server/scope.js';
import {
	BENCHMARKS,
	DEFAULT_RANGE,
	intervalForRange,
	isBenchmarkSymbol,
	isIntradayRange,
	periodForRange,
	type BenchmarkSymbol
} from '$lib/benchmarks.js';
import { getProvider } from '$lib/providers/index.js';
import {
	RANGES,
	type Bar,
	type HistoryRequest,
	type Interval,
	type Range,
	type SessionPolicy
} from '$lib/providers/types.js';
import { windowedPctChange } from '$lib/chart/normalize.js';

const SYMBOL_RE = /^[A-Z\^.\-]{1,8}$/;
const MAX_STOCKS = 8;
const MAX_COMPARES = 8;

type ClosePoint = { time: number; close: number };

type SeriesKind = 'stock' | 'comparison';

type Series = {
	symbol: string;
	kind: SeriesKind;
	currency: string;
	aligned: ClosePoint[];
	summary: { lastPrice: number; lastPriceTime: number; pctChange: number };
};

type ReturnBasis = 'price-only' | 'total-return' | 'mixed';

type MultiResponse = {
	series: Series[];
	primaryVolume: { symbol: string; data: { time: number; volume: number }[] };
	meta: {
		interval: Interval;
		session: SessionPolicy;
		timezone: string;
		windowStart: number;
		windowEnd: number;
		returnBasis: ReturnBasis;
	};
};

const cache = new LRUCache<MultiResponse>({ max: 200, ttlMs: 60_000 });
const throttle = new SlidingWindowThrottle({ windowMs: 60_000, max: 20 });

function clientKey(request: Request, getClientAddress: () => string): string {
	const cfIp = request.headers.get('cf-connecting-ip');
	const xff = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
	try {
		return cfIp || xff || getClientAddress();
	} catch {
		return cfIp || xff || 'unknown';
	}
}

function parseCsvSymbols(raw: string | null): string[] {
	if (!raw) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of raw.split(',')) {
		const s = part.trim().toUpperCase();
		if (!s) continue;
		if (seen.has(s)) continue;
		seen.add(s);
		out.push(s);
	}
	return out;
}

function pickReturnBasis(compares: BenchmarkSymbol[]): ReturnBasis {
	if (compares.length === 0) return 'price-only';
	let hasTR = false;
	let hasPO = false;
	for (const c of compares) {
		if (BENCHMARKS[c].policy === 'total-return') hasTR = true;
		else hasPO = true;
	}
	if (hasTR && hasPO) return 'mixed';
	return hasTR ? 'total-return' : 'price-only';
}

function buildRequest(range: Range, compares: BenchmarkSymbol[], now: Date): HistoryRequest {
	const { period1, period2 } = periodForRange(range, now);
	const adjusted =
		!isIntradayRange(range) && compares.some((c) => BENCHMARKS[c].policy === 'total-return');
	return {
		interval: intervalForRange(range),
		session: 'regular',
		adjusted,
		period1,
		period2
	};
}

function intersectionTimes(barsBySymbol: Map<string, Bar[]>): number[] {
	let common: Set<number> | null = null;
	for (const bars of barsBySymbol.values()) {
		const s = new Set<number>();
		for (const b of bars) s.add(b.time);
		if (common === null) {
			common = s;
		} else {
			const next = new Set<number>();
			for (const t of common) if (s.has(t)) next.add(t);
			common = next;
		}
		if (common.size === 0) return [];
	}
	if (!common) return [];
	return [...common].sort((a, b) => a - b);
}

function alignBars(bars: Bar[], times: number[]): ClosePoint[] {
	const byTime = new Map<number, number>();
	for (const b of bars) byTime.set(b.time, b.close);
	const out: ClosePoint[] = [];
	for (const t of times) {
		const c = byTime.get(t);
		if (c !== undefined) out.push({ time: t, close: c });
	}
	return out;
}

function alignVolume(bars: Bar[], times: number[]): { time: number; volume: number }[] {
	const byTime = new Map<number, number>();
	for (const b of bars) byTime.set(b.time, b.volume);
	const out: { time: number; volume: number }[] = [];
	for (const t of times) {
		const v = byTime.get(t);
		if (v !== undefined) out.push({ time: t, volume: v });
	}
	return out;
}

export const GET: RequestHandler = async ({ url, request, getClientAddress, platform }) => {
	const stocks = parseCsvSymbols(url.searchParams.get('stocks'));
	const comparesRaw = parseCsvSymbols(url.searchParams.get('compares'));
	const rangeRaw = (url.searchParams.get('range') ?? '').trim().toUpperCase();
	const range = (rangeRaw || DEFAULT_RANGE) as Range;

	if (stocks.length === 0) throw error(400, 'at least one stock is required');
	if (stocks.length > MAX_STOCKS) throw error(400, `at most ${MAX_STOCKS} stocks`);
	if (comparesRaw.length > MAX_COMPARES) throw error(400, `at most ${MAX_COMPARES} compares`);
	if (!(RANGES as ReadonlyArray<string>).includes(range)) {
		throw error(400, `range must be one of: ${RANGES.join(', ')}`);
	}
	for (const s of stocks) {
		if (!SYMBOL_RE.test(s)) throw error(400, `invalid stock symbol: ${s}`);
	}
	const compares: BenchmarkSymbol[] = [];
	for (const c of comparesRaw) {
		if (!isBenchmarkSymbol(c)) throw error(400, `unsupported benchmark: ${c}`);
		compares.push(c);
	}

	const tKey = clientKey(request, getClientAddress);
	const edgeLimited = await checkEdgeRateLimit(platform, tKey);
	if (edgeLimited) return edgeLimited;
	const gate = throttle.take(tKey);
	if (!gate.ok) {
		return new Response('Too Many Requests', {
			status: 429,
			headers: { 'Retry-After': Math.ceil(gate.retryAfterMs / 1000).toString() }
		});
	}

	const lruKey = `multi|${stocks.join(',')}|${compares.join(',')}|${range}`;
	const cacheUrl = (() => {
		const u = new URL('/api/history-multi', url.origin);
		u.searchParams.set('stocks', stocks.join(','));
		u.searchParams.set('compares', compares.join(','));
		u.searchParams.set('range', range);
		return u.toString();
	})();
	const cacheKey = new Request(cacheUrl, { method: 'GET' });

	const lruHit = cache.get(lruKey);
	if (lruHit) {
		return json(lruHit, {
			headers: {
				'Cache-Control': 'public, max-age=0, s-maxage=60',
				'X-Cache': 'lru-hit'
			}
		});
	}

	const edgeCaches = platform?.caches as
		| {
				default: {
					match(req: Request): Promise<Response | undefined>;
					put(req: Request, res: Response): Promise<void>;
				};
		  }
		| undefined;
	if (edgeCaches) {
		try {
			const edgeHit = await edgeCaches.default.match(cacheKey);
			if (edgeHit) {
				try {
					const parsed = (await edgeHit.clone().json()) as MultiResponse;
					cache.set(lruKey, parsed);
				} catch {
					/* ignore parse errors */
				}
				const out = new Response(edgeHit.body, edgeHit);
				out.headers.set('X-Cache', 'edge-hit');
				return out;
			}
		} catch (e) {
			// Edge cache is a best-effort optimization; a read failure must not
			// take down the request. Log and fall through to a fresh fetch.
			console.error('edge cache read failed; proceeding without it', e);
		}
	}

	const provider = getProvider();
	const req = buildRequest(range, compares, new Date());

	const allSymbols: Array<{ symbol: string; kind: SeriesKind }> = [
		...stocks.map((s) => ({ symbol: s, kind: 'stock' as const })),
		...compares.map((s) => ({ symbol: s, kind: 'comparison' as const }))
	];

	const settled = await Promise.all(
		allSymbols.map(({ symbol }) =>
			provider.getHistory(symbol, req).catch((e: unknown) => ({ error: e }))
		)
	);

	const fetched = new Map<
		string,
		{ kind: SeriesKind; result: Awaited<ReturnType<typeof provider.getHistory>>['result'] }
	>();
	for (let i = 0; i < allSymbols.length; i++) {
		const { symbol, kind } = allSymbols[i];
		const r = settled[i];
		if ('error' in r) {
			console.error('provider error', symbol, r.error);
			throw error(502, `unable to fetch ${symbol}`);
		}
		if (kind === 'stock' && !isTargetInScope(r.result.meta)) {
			throw error(400, `${symbol} is not a supported instrument (equity, ETF, or index)`);
		}
		fetched.set(symbol, { kind, result: r.result });
	}

	const barsBySymbol = new Map<string, Bar[]>();
	for (const [sym, { result }] of fetched) {
		barsBySymbol.set(sym, result.bars);
	}
	const commonTimes = intersectionTimes(barsBySymbol);
	if (commonTimes.length === 0) {
		throw error(502, 'no overlapping bars across requested symbols');
	}

	const series: Series[] = allSymbols.map(({ symbol, kind }) => {
		const r = fetched.get(symbol)!.result;
		const aligned = alignBars(r.bars, commonTimes);
		return {
			symbol,
			kind,
			currency: r.currency,
			aligned,
			summary: {
				lastPrice: r.lastPrice,
				lastPriceTime: r.lastPriceTime,
				pctChange: windowedPctChange(aligned)
			}
		};
	});

	const primarySymbol = stocks[0];
	const primary = fetched.get(primarySymbol)!.result;
	const primaryVolume = {
		symbol: primarySymbol,
		data: alignVolume(primary.bars, commonTimes)
	};

	const response: MultiResponse = {
		series,
		primaryVolume,
		meta: {
			interval: req.interval,
			session: req.session,
			timezone: primary.timezone,
			windowStart: commonTimes[0],
			windowEnd: commonTimes[commonTimes.length - 1],
			returnBasis: pickReturnBasis(compares)
		}
	};

	cache.set(lruKey, response);

	const body = JSON.stringify(response);
	const headers = {
		'Content-Type': 'application/json',
		'Cache-Control': 'public, max-age=0, s-maxage=60',
		'X-Cache': 'miss'
	};
	const out = new Response(body, { status: 200, headers });
	if (edgeCaches && platform?.ctx) {
		platform.ctx.waitUntil(edgeCaches.default.put(cacheKey, out.clone()));
	} else if (edgeCaches) {
		await edgeCaches.default.put(cacheKey, out.clone());
	}
	return out;
};
