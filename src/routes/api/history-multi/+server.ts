import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LRUCache } from '$lib/server/cache.js';
import { SlidingWindowThrottle } from '$lib/server/throttle.js';
import { checkEdgeRateLimit } from '$lib/server/ratelimit.js';
import { isTargetInScope } from '$lib/server/scope.js';
import {
	DEFAULT_RANGE,
	intervalForRange,
	isIntradayRange,
	periodForRange
} from '$lib/benchmarks.js';
import { isValidSymbol, MAX_SYMBOLS, parseBasis } from '$lib/selection.js';
import { getProvider } from '$lib/providers/index.js';
import {
	RANGES,
	type Bar,
	type HistoryRequest,
	type HistoryResult,
	type Interval,
	type Range,
	type ReturnBasis,
	type SeriesKind,
	type SessionPolicy
} from '$lib/providers/types.js';
import { unionForwardFill, windowedPctChange, type ClosePoint } from '$lib/chart/normalize.js';

type Series = {
	symbol: string;
	kind: SeriesKind;
	asset: 'EQUITY' | 'ETF' | 'INDEX';
	currency: string;
	aligned: ClosePoint[];
	summary: { lastPrice: number; lastPriceTime: number; pctChange?: number };
};

type MultiResponse = {
	series: Series[];
	primaryVolume: { symbol: string; data: { time: number; volume: number }[] };
	meta: {
		interval: Interval;
		session: SessionPolicy;
		timezone: string;
		windowStart: number;
		windowEnd: number;
		baseTime: number;
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

export const GET: RequestHandler = async ({ url, request, getClientAddress, platform }) => {
	const symbols = parseCsvSymbols(url.searchParams.get('symbols'));
	const rangeRaw = (url.searchParams.get('range') ?? '').trim().toUpperCase();
	const range = (rangeRaw || DEFAULT_RANGE) as Range;

	if (symbols.length === 0) throw error(400, 'at least one symbol is required');
	if (symbols.length > MAX_SYMBOLS) throw error(400, `at most ${MAX_SYMBOLS} symbols`);
	if (!(RANGES as ReadonlyArray<string>).includes(range)) {
		throw error(400, `range must be one of: ${RANGES.join(', ')}`);
	}
	for (const s of symbols) {
		if (!isValidSymbol(s)) throw error(400, `invalid symbol: ${s}`);
	}

	// Basis: a bad client param should surface (400), not silently default — but
	// an absent param degrades to the shared default.
	const basisRaw = url.searchParams.get('basis');
	if (basisRaw !== null && basisRaw !== 'total' && basisRaw !== 'price') {
		throw error(400, "basis must be 'total' or 'price'");
	}
	const basis = parseBasis(basisRaw);

	const tKey = clientKey(request, getClientAddress);
	const edgeLimited = await checkEdgeRateLimit(platform, `history:${tKey}`);
	if (edgeLimited) return edgeLimited;
	const gate = throttle.take(tKey);
	if (!gate.ok) {
		return new Response('Too Many Requests', {
			status: 429,
			headers: { 'Retry-After': Math.ceil(gate.retryAfterMs / 1000).toString() }
		});
	}

	const lruKey = `multi|${symbols.join(',')}|${basis}|${range}`;
	const cacheUrl = (() => {
		const u = new URL('/api/history-multi', url.origin);
		u.searchParams.set('symbols', symbols.join(','));
		u.searchParams.set('basis', basis === 'total-return' ? 'total' : 'price');
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
	const { period1, period2 } = periodForRange(range, new Date());
	// Return basis applies to daily-and-longer only; intraday is always price-only.
	const adjusted = !isIntradayRange(range) && basis === 'total-return';
	const req: HistoryRequest = {
		interval: intervalForRange(range),
		session: 'regular',
		adjusted,
		period1,
		period2
	};

	const settled = await Promise.all(
		symbols.map((symbol) => provider.getHistory(symbol, req).catch((e: unknown) => ({ error: e })))
	);

	const fetched = new Map<string, HistoryResult>();
	for (let i = 0; i < symbols.length; i++) {
		const symbol = symbols[i];
		const r = settled[i];
		if ('error' in r) {
			console.error('provider error', symbol, r.error);
			throw error(502, `unable to fetch ${symbol}`);
		}
		// Every symbol must be a supported instrument now — not just the old "stocks".
		if (!isTargetInScope(r.result.meta)) {
			throw error(400, `${symbol} is not a supported instrument (equity, ETF, or index)`);
		}
		fetched.set(symbol, r.result);
	}

	const kindOf = (symbol: string): SeriesKind =>
		fetched.get(symbol)!.meta.asset === 'INDEX' ? 'index' : 'equity';

	const barsBySymbol = new Map<string, Bar[]>();
	for (const [symbol, result] of fetched) barsBySymbol.set(symbol, result.bars);

	// Union + forward-fill (LOCF) with a common baseline. A symbol with zero
	// in-window bars yields an empty `aligned` (its line is absent); we only 502
	// when *every* symbol is empty.
	const { times, baseTime, aligned } = unionForwardFill(barsBySymbol);
	const allEmpty = symbols.every((s) => (aligned.get(s)?.length ?? 0) === 0);
	if (allEmpty) {
		throw error(502, 'no data for requested symbols');
	}

	const series: Series[] = symbols.map((symbol) => {
		const result = fetched.get(symbol)!;
		const a = aligned.get(symbol) ?? [];
		return {
			symbol,
			kind: kindOf(symbol),
			asset: result.meta.asset as 'EQUITY' | 'ETF' | 'INDEX',
			currency: result.currency,
			aligned: a,
			summary: {
				lastPrice: result.lastPrice,
				lastPriceTime: result.lastPriceTime,
				// close at baseTime → last (real or LOCF-carried-real) close = the
				// rendered span. `undefined` for an empty/absent series → "—", not 0%.
				pctChange: windowedPctChange(a, baseTime)
			}
		};
	});

	// One server-chosen anchor drives both the volume sub-pane AND the tooltip's
	// timezone, so they can never reference different series. Anchor = first equity
	// in list order, else the first symbol. Ship the anchor's OWN raw bars (not
	// intersected) so a sparse co-series can't zero out real volume bars.
	const anchorSymbol = symbols.find((s) => kindOf(s) === 'equity') ?? symbols[0];
	const anchorResult = fetched.get(anchorSymbol)!;
	const primaryVolume = {
		symbol: anchorSymbol,
		data: anchorResult.bars.map((b) => ({ time: b.time, volume: b.volume }))
	};

	const response: MultiResponse = {
		series,
		primaryVolume,
		meta: {
			interval: req.interval,
			session: req.session,
			timezone: anchorResult.timezone,
			windowStart: times[0],
			windowEnd: times[times.length - 1],
			baseTime,
			returnBasis: isIntradayRange(range) ? 'price-only' : basis
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
