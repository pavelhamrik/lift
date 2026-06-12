import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LRUCache } from '$lib/server/cache.js';
import { SlidingWindowThrottle } from '$lib/server/throttle.js';
import { checkEdgeRateLimit } from '$lib/server/ratelimit.js';
import { isFixtureMode } from '$lib/providers/index.js';
import { BENCHMARKS, isBenchmarkSymbol } from '$lib/benchmarks.js';

const SYMBOL_RE = /^[A-Z\^.\-]{1,8}$/;

// Yahoo's public search endpoint resolves a symbol to its display name without
// a crumb/cookie, so it works on the Workers runtime. (We avoid yahoo-finance2
// here for the same reason as the history provider: it can't load under workerd.)
const YAHOO_SEARCH_BASE = 'https://query1.finance.yahoo.com/v1/finance/search';
const YAHOO_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

type LookupResult = { symbol: string; name: string; currency?: string };
type CachedEntry = { kind: 'found'; value: LookupResult } | { kind: 'notfound' };

type YahooSearchResponse = {
	quotes?: Array<{
		symbol?: string;
		shortname?: string;
		longname?: string;
		currency?: string;
	}>;
};

const cache = new LRUCache<CachedEntry>({ max: 1000, ttlMs: 24 * 60 * 60 * 1000 });
const throttle = new SlidingWindowThrottle({ windowMs: 60_000, max: 60 });

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

	// Fixture mode: short-circuit before the throttle, edge cache, and Yahoo
	// search fetch. Never touch the network in `npm run dev:static`.
	if (isFixtureMode()) {
		const result: LookupResult = {
			symbol: raw,
			name: isBenchmarkSymbol(raw) ? BENCHMARKS[raw].label : raw,
			currency: isBenchmarkSymbol(raw) ? BENCHMARKS[raw].currency : 'USD'
		};
		return json(result, { headers: { 'X-Cache': 'fixture' } });
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

	let searchJson: YahooSearchResponse;
	try {
		const u = new URL(YAHOO_SEARCH_BASE);
		u.searchParams.set('q', raw);
		u.searchParams.set('quotesCount', '6');
		u.searchParams.set('newsCount', '0');
		const res = await fetch(u, { headers: { 'User-Agent': YAHOO_UA, accept: 'application/json' } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		searchJson = (await res.json()) as YahooSearchResponse;
	} catch {
		cache.set(lruKey, { kind: 'notfound' });
		throw error(404, 'not found');
	}

	const quotes = searchJson.quotes ?? [];
	// Prefer an exact symbol match; fall back to the top-ranked result.
	const match = quotes.find((q) => (q.symbol ?? '').toUpperCase() === raw) ?? quotes[0];
	const name = match?.longname ?? match?.shortname ?? '';
	if (!match || !match.symbol || !name) {
		cache.set(lruKey, { kind: 'notfound' });
		throw error(404, 'not found');
	}

	const result: LookupResult = {
		symbol: match.symbol,
		name,
		currency: match.currency
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
