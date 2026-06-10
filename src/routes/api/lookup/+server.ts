import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import YahooFinance from 'yahoo-finance2';
import { LRUCache } from '$lib/server/cache.js';
import { SlidingWindowThrottle } from '$lib/server/throttle.js';
import { checkEdgeRateLimit } from '$lib/server/ratelimit.js';

const SYMBOL_RE = /^[A-Z\^.\-]{1,8}$/;

type LookupResult = { symbol: string; name: string; currency?: string };
type CachedEntry = { kind: 'found'; value: LookupResult } | { kind: 'notfound' };

const cache = new LRUCache<CachedEntry>({ max: 1000, ttlMs: 24 * 60 * 60 * 1000 });
const throttle = new SlidingWindowThrottle({ windowMs: 60_000, max: 60 });

const client = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

function clientKey(request: Request, getClientAddress: () => string): string {
	const cfIp = request.headers.get('cf-connecting-ip');
	const xff = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
	try {
		return cfIp || xff || getClientAddress();
	} catch {
		return cfIp || xff || 'unknown';
	}
}

export const GET: RequestHandler = async ({ url, request, getClientAddress, platform }) => {
	const raw = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();
	if (!raw) throw error(400, 'symbol required');
	if (!SYMBOL_RE.test(raw)) throw error(400, 'invalid symbol');

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

	const lruKey = `lookup|${raw}`;
	const lruHit = cache.get(lruKey);
	if (lruHit) {
		if (lruHit.kind === 'notfound') throw error(404, 'not found');
		return json(lruHit.value, {
			headers: {
				'Cache-Control': 'public, max-age=0, s-maxage=86400',
				'X-Cache': 'lru-hit'
			}
		});
	}

	const cacheUrl = (() => {
		const u = new URL('/api/lookup', url.origin);
		u.searchParams.set('symbol', raw);
		return u.toString();
	})();
	const cacheKey = new Request(cacheUrl, { method: 'GET' });

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
					const parsed = (await edgeHit.clone().json()) as LookupResult;
					cache.set(lruKey, { kind: 'found', value: parsed });
				} catch {
					/* ignore */
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

	let q: unknown;
	try {
		q = await client.quote(raw);
	} catch {
		cache.set(lruKey, { kind: 'notfound' });
		throw error(404, 'not found');
	}

	if (!q || typeof q !== 'object') {
		cache.set(lruKey, { kind: 'notfound' });
		throw error(404, 'not found');
	}

	const obj = q as {
		longName?: string;
		shortName?: string;
		displayName?: string;
		symbol?: string;
		currency?: string;
	};
	const name = obj.longName ?? obj.shortName ?? obj.displayName ?? '';
	if (!name) {
		cache.set(lruKey, { kind: 'notfound' });
		throw error(404, 'not found');
	}

	const result: LookupResult = {
		symbol: obj.symbol ?? raw,
		name,
		currency: obj.currency
	};
	cache.set(lruKey, { kind: 'found', value: result });

	const body = JSON.stringify(result);
	const headers = {
		'Content-Type': 'application/json',
		'Cache-Control': 'public, max-age=0, s-maxage=86400',
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
