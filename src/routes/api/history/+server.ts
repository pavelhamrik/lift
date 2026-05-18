import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canonicalizeAndValidate, canonicalCacheKey, canonicalRequestUrl } from '$lib/server/validate.js';
import { LRUCache } from '$lib/server/cache.js';
import { SlidingWindowThrottle } from '$lib/server/throttle.js';
import { isTargetInScope } from '$lib/server/scope.js';
import {
	adjustedFor,
	BENCHMARKS,
	effectiveReturnBasis,
	intervalForRange,
	type BenchmarkSymbol
} from '$lib/benchmarks.js';
import { getProvider } from '$lib/providers/index.js';
import type {
	HistoryRequest,
	HistoryResult,
	InstrumentMeta,
	Interval,
	Range,
	SessionPolicy
} from '$lib/providers/types.js';
import { innerJoinByTime, windowedPctChange } from '$lib/chart/normalize.js';

type ClosePoint = { time: number; close: number };

type HistoryResponse = {
	aligned: { target: ClosePoint[]; benchmark: ClosePoint[] };
	targetVolume: { time: number; volume: number }[];
	meta: {
		target: { symbol: string; currency: string; meta: InstrumentMeta };
		benchmark: { symbol: string; currency: string; meta: InstrumentMeta };
		interval: Interval;
		session: SessionPolicy;
		timezone: string;
		windowStart: number;
		windowEnd: number;
		returnBasis: 'price-only' | 'total-return';
	};
	summary: {
		target: { lastPrice: number; lastPriceTime: number; pctChange: number };
		benchmark: { lastPrice: number; lastPriceTime: number; pctChange: number };
	};
};

const cache = new LRUCache<HistoryResponse>({ max: 500, ttlMs: 60_000 });
const throttle = new SlidingWindowThrottle({ windowMs: 60_000, max: 30 });

function clientKey(request: Request, getClientAddress: () => string): string {
	const cfIp = request.headers.get('cf-connecting-ip');
	const xff = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
	try {
		return cfIp || xff || getClientAddress();
	} catch {
		return cfIp || xff || 'unknown';
	}
}

function buildRequest(range: Range, bench: BenchmarkSymbol): HistoryRequest {
	return {
		interval: intervalForRange(range),
		session: 'regular',
		adjusted: adjustedFor(range, bench)
	};
}

function summarize(result: HistoryResult, aligned: ClosePoint[]) {
	return {
		lastPrice: result.lastPrice,
		lastPriceTime: result.lastPriceTime,
		pctChange: windowedPctChange(aligned)
	};
}

export const GET: RequestHandler = async ({ url, request, getClientAddress, platform }) => {
	const validation = canonicalizeAndValidate({
		symbol: url.searchParams.get('symbol'),
		benchmark: url.searchParams.get('benchmark'),
		range: url.searchParams.get('range')
	});
	if (!validation.ok) {
		throw error(400, validation.error);
	}
	const canonical = validation.canonical;

	const tKey = clientKey(request, getClientAddress);
	const gate = throttle.take(tKey);
	if (!gate.ok) {
		return new Response('Too Many Requests', {
			status: 429,
			headers: { 'Retry-After': Math.ceil(gate.retryAfterMs / 1000).toString() }
		});
	}

	const lruKey = canonicalCacheKey(canonical);
	const cacheUrl = canonicalRequestUrl(url.origin, canonical);
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
		| { default: { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> } }
		| undefined;
	if (edgeCaches) {
		const edgeHit = await edgeCaches.default.match(cacheKey);
		if (edgeHit) {
			try {
				const parsed = (await edgeHit.clone().json()) as HistoryResponse;
				cache.set(lruKey, parsed);
			} catch {
				/* ignore parse errors, treat as miss */
			}
			const out = new Response(edgeHit.body, edgeHit);
			out.headers.set('X-Cache', 'edge-hit');
			return out;
		}
	}

	const provider = getProvider();
	const req = buildRequest(canonical.range, canonical.benchmark);

	const [tFetch, bFetch] = await Promise.all([
		provider.getHistory(canonical.symbol, req).catch((e: unknown) => ({ error: e })),
		provider.getHistory(canonical.benchmark, req).catch((e: unknown) => ({ error: e }))
	]);

	if ('error' in tFetch) {
		console.error('provider error (target)', canonical.symbol, tFetch.error);
		throw error(502, `unable to fetch ${canonical.symbol}`);
	}
	if ('error' in bFetch) {
		console.error('provider error (benchmark)', canonical.benchmark, bFetch.error);
		throw error(502, `unable to fetch ${canonical.benchmark}`);
	}

	const tRes = tFetch.result;
	const bRes = bFetch.result;

	if (!isTargetInScope(tRes.meta)) {
		throw error(400, `${canonical.symbol} is not a supported instrument (US equity/ETF only)`);
	}
	if (!BENCHMARKS[canonical.benchmark]) {
		throw error(400, `unsupported benchmark`);
	}

	const aligned = innerJoinByTime(tRes.bars, bRes.bars);
	if (aligned.target.length === 0) {
		throw error(502, `no overlapping bars for ${canonical.symbol} vs ${canonical.benchmark}`);
	}

	const targetVolume = tRes.bars.map((b) => ({ time: b.time, volume: b.volume }));

	const response: HistoryResponse = {
		aligned,
		targetVolume,
		meta: {
			target: { symbol: tRes.symbol, currency: tRes.currency, meta: tRes.meta },
			benchmark: { symbol: bRes.symbol, currency: bRes.currency, meta: bRes.meta },
			interval: req.interval,
			session: req.session,
			timezone: tRes.timezone,
			windowStart: aligned.target[0].time,
			windowEnd: aligned.target[aligned.target.length - 1].time,
			returnBasis: effectiveReturnBasis(canonical.range, canonical.benchmark)
		},
		summary: {
			target: summarize(tRes, aligned.target),
			benchmark: summarize(bRes, aligned.benchmark)
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
