import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LRUCache } from '$lib/server/cache.js';
import { SlidingWindowThrottle } from '$lib/server/throttle.js';
import { checkEdgeRateLimit } from '$lib/server/ratelimit.js';
import { isFixtureMode } from '$lib/providers/index.js';
import { searchLocal, kindForAsset, type SymbolSearchResult } from '$lib/symbols.js';

// Yahoo's `lookup` endpoint — not the `search`/autocomplete one — is the only public
// endpoint that honors a server-side `type` filter and a real `count`. The autocomplete
// endpoint hard-caps at ~7 results, ignores `quotesCount` above that, and ignores any
// type filter, so a phrase like "s&p" fills its 7 slots with futures/FX that we'd then
// drop to nothing. `lookup` returns only the instrument types we ask for, already
// ranked, so every row is addable.
const YAHOO_LOOKUP_BASE = 'https://query1.finance.yahoo.com/v1/finance/lookup';
const YAHOO_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// The list threshold: below this we let the client's local browse list show.
const MIN_Q = 2;

// How many results to request from `lookup`. It's type-filtered upstream, so there's
// nothing to over-fetch against — this is simply how many to show.
const LOOKUP_COUNT = 15;

type YahooLookupDoc = {
	symbol?: string;
	shortName?: string;
	quoteType?: string; // lowercase from this endpoint: 'equity' | 'etf' | 'index' | …
	exchange?: string; // raw code (e.g. 'PCX'/'NGM'/'SNP') — too cryptic to surface
};
type YahooLookupResponse = {
	finance?: { result?: Array<{ documents?: YahooLookupDoc[] }> };
};

const cache = new LRUCache<SymbolSearchResult[]>({ max: 500, ttlMs: 5 * 60 * 1000 });
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

function mapDoc(doc: YahooLookupDoc): SymbolSearchResult | null {
	const symbol = (doc.symbol ?? '').toUpperCase();
	if (!symbol) return null;
	// `lookup` already restricts to these via `type=…`; this guard stays as defense in
	// depth should the param ever be ignored. quoteType arrives lowercase here.
	const qt = (doc.quoteType ?? '').toUpperCase();
	let asset: 'EQUITY' | 'ETF' | 'INDEX';
	if (qt === 'EQUITY') asset = 'EQUITY';
	else if (qt === 'ETF') asset = 'ETF';
	else if (qt === 'INDEX') asset = 'INDEX';
	else return null; // drop MUTUALFUND/CURRENCY/FUTURE/CRYPTO — not addable
	// `exchange` is intentionally dropped: lookup only gives a raw code (PCX/NGM/SNP),
	// and the symbol's own suffix (.DE/.MX) already disambiguates dual listings.
	return { symbol, name: doc.shortName ?? symbol, asset, kind: kindForAsset(asset) };
}

export const GET: RequestHandler = async ({ url, request, getClientAddress, platform }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	if (q.length < MIN_Q) return json([] as SymbolSearchResult[]);

	// Fixture mode: resolve from the bundled set plus a synthetic exact match for
	// `q` itself, so `dev:static` keeps the "any symbol" promise with zero network.
	if (isFixtureMode()) {
		const local = searchLocal(q);
		const exact = q.toUpperCase();
		const hasExact = local.some((r) => r.symbol.toUpperCase() === exact);
		const out = hasExact
			? local
			: [
					...local,
					{ symbol: exact, name: exact, asset: 'EQUITY' as const, kind: 'equity' as const }
				];
		return json(out, { headers: { 'X-Cache': 'fixture' } });
	}

	const tKey = clientKey(request, getClientAddress);
	const edgeLimited = await checkEdgeRateLimit(platform, `search:${tKey}`);
	if (edgeLimited) return edgeLimited;
	const gate = throttle.take(tKey);
	if (!gate.ok) {
		return new Response('Too Many Requests', {
			status: 429,
			headers: { 'Retry-After': Math.ceil(gate.retryAfterMs / 1000).toString() }
		});
	}

	const key = q.toUpperCase();
	const lruKey = `search|${key}`;
	const lruHit = cache.get(lruKey);
	if (lruHit) {
		return json(lruHit, {
			headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300', 'X-Cache': 'lru-hit' }
		});
	}

	const cacheUrl = (() => {
		const u = new URL('/api/search', url.origin);
		u.searchParams.set('q', key);
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
					const parsed = (await edgeHit.clone().json()) as SymbolSearchResult[];
					cache.set(lruKey, parsed);
				} catch {
					/* ignore parse errors */
				}
				const out = new Response(edgeHit.body, edgeHit);
				out.headers.set('X-Cache', 'edge-hit');
				return out;
			}
		} catch (e) {
			console.error('edge cache read failed; proceeding without it', e);
		}
	}

	let lookupJson: YahooLookupResponse;
	try {
		const u = new URL(YAHOO_LOOKUP_BASE);
		u.searchParams.set('query', q);
		u.searchParams.set('type', 'equity,etf,index');
		u.searchParams.set('count', String(LOOKUP_COUNT));
		u.searchParams.set('start', '0');
		u.searchParams.set('formatted', 'false');
		u.searchParams.set('lang', 'en-US');
		u.searchParams.set('region', 'US');
		const res = await fetch(u, { headers: { 'User-Agent': YAHOO_UA, accept: 'application/json' } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		lookupJson = (await res.json()) as YahooLookupResponse;
	} catch (e) {
		// Transient upstream failure — return a distinct 502 and do NOT cache, so a
		// retry isn't masked by a poisoned empty entry.
		console.error('yahoo lookup failed', q, e);
		throw error(502, 'search upstream failed');
	}

	const results = (lookupJson.finance?.result?.[0]?.documents ?? [])
		.map(mapDoc)
		.filter((r): r is SymbolSearchResult => r !== null);

	// Cache successes and genuine empty results (a real "no matches" is worth
	// caching); transient failures already threw above and never reach here.
	cache.set(lruKey, results);

	const body = JSON.stringify(results);
	const headers = {
		'Content-Type': 'application/json',
		'Cache-Control': 'public, max-age=0, s-maxage=300',
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
