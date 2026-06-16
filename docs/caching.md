# Caching behavior

How Lift avoids needless Yahoo calls, where each cache lives, and what is (and
isn't) shared between users. Reference doc — for the change that introduced the
raw-fetch layer see [plans/2026-06-10-cache-first-fetching.md](./plans/2026-06-10-cache-first-fetching.md).

## Where "the server" is

Lift is a SvelteKit app compiled into a **single Cloudflare Worker**
(`@sveltejs/adapter-cloudflare`, Workers + Static Assets; see
[PLAN.md](../PLAN.md)). The build emits `.svelte-kit/cloudflare/_worker.js` —
that bundle _is_ the server. The `+server.ts` route handlers run on Cloudflare's
`workerd` runtime at the edge. There is **no Node origin and no Supabase edge
function** in the price-data path; Supabase is auth-only. Yahoo's public v8 chart
JSON is the upstream, fetched directly by the Worker.

```
Browser (Svelte SPA, +page.svelte)            static assets, served by the Worker
        │  GET /api/history-multi?symbols=…&basis=…&range=…
        ▼
Cloudflare Worker  (_worker.js · workerd)      ← "the server": route handlers + caches
        │  getProvider().getHistory(symbol, req)   (once per symbol)
        ▼
Yahoo v8 chart JSON  (query1.finance.yahoo.com)   ← upstream
```

## The request path (history-multi)

`/api/history-multi` is the endpoint the client calls. In order, a request hits:

1. **Validation** — symbols, basis, range, and the per-request limit
   (`MAX_SYMBOLS = 16`). Over-limit, empty, unknown-symbol, or bad basis/range
   requests are rejected with `400` (no silent clamping).
2. **Edge rate limiter** (`RATE_LIMITER` binding) — per-IP, per-CF-location.
   Returns `429` or proceeds. No-op off Workers.
3. **In-process throttle** — `SlidingWindowThrottle`, 20 requests / 60 s per
   client key. Best-effort per-isolate; primarily the local-dev guard.
4. **`MultiResponse` LRU** (in-isolate memory) → hit ⇒ respond `X-Cache: lru-hit`.
5. **Edge cache** (`caches.default`) → hit ⇒ respond `X-Cache: edge-hit` (and
   re-populate the LRU).
6. **Provider fetch** — for each symbol, `provider.getHistory(...)`, which goes
   through the **raw-fetch cache + single-flight** before any Yahoo call.
7. Build, align, cache (LRU + edge), respond `X-Cache: miss`.

> The rate limiter and throttle run **before** the caches, so a superseded or
> repeated request still counts against the per-IP budget even when it would have
> been a cache hit. This is why the client also cancels superseded requests
> (see [Client-side cancellation](#client-side-cancellation)).

## The three cache layers

All three live in the Worker. They are checked outermost-first (cheap → costly)
and populated on the way back out.

| Layer                             | Key                                            | TTL              | Where it lives                  | `X-Cache`  |
| --------------------------------- | ---------------------------------------------- | ---------------- | ------------------------------- | ---------- |
| **Edge cache** `caches.default`   | full request URL (`symbols`, `basis`, `range`) | `s-maxage=60`    | per **colo** (data center)      | `edge-hit` |
| **`MultiResponse` LRU**           | `multi\|symbols\|basis\|range`                 | 60 s, `max: 200` | per **isolate** (module memory) | `lru-hit`  |
| **Raw-fetch LRU + single-flight** | `symbol\|interval\|includePrePost`             | 60 s, split caps | per **isolate** (module memory) | (internal) |

### 1. Edge cache (`caches.default`)

Cloudflare's HTTP cache, keyed by the canonicalized request URL. It is the only
layer **shared across isolates** within a data center, and the most durable of
the three. Responses carry `Cache-Control: public, max-age=0, s-maxage=60` —
`max-age=0` keeps browsers from holding stale copies; `s-maxage=60` lets the edge
serve a shared copy for 60 s. On a hit the handler also re-seeds the in-isolate
LRU so a subsequent same-isolate request skips even the edge lookup.

### 2. `MultiResponse` LRU (whole-response, per request shape)

A bounded `LRUCache` (`src/lib/server/cache.ts`) in Worker module scope, keyed by
the exact `(symbols, basis, range)` tuple. It caches the **fully assembled,
aligned response**. It absorbs _exact repeats_ (auto-refresh polls, reloads,
two users on the identical selection) but **misses on any change** — add/remove a
ticker or flip the range and the key changes.

### 3. Raw-fetch cache + single-flight (per symbol)

`withCachedFetch` (`src/lib/server/cached-fetch.ts`) wraps the provider's
`FetchChart` seam, **beneath** `makeYahooProvider`. It is what makes range flips
and ticker edits cheap: it caches the **raw Yahoo chart response per
`(symbol, interval, session)`** and slices every range out of it.

- **Canonical window.** Each request is widened to the _widest range that uses
  its interval_ before hitting Yahoo, anchored to the request's own `period2`
  (never wall-clock — a late `Date.now()` could start the window _after_ the
  caller's first bar and drop it). `buildResultFromChart` then re-slices the raw
  back to the caller's real `period1/period2`, so the widening is invisible.

  | interval | canonical window   | serves ranges       |
  | -------- | ------------------ | ------------------- |
  | `1m`     | ~7 days            | 1D                  |
  | `5m`     | ~35 days           | 5D                  |
  | `1d`     | ~13 months         | **1M, 6M, YTD, 1Y** |
  | `1wk`    | ~5 years + 1 month | 5Y                  |
  | `1mo`    | epoch → now        | MAX                 |

  So the first request for _any_ daily range fetches ~13 months once; 1M/6M/YTD/1Y
  then all slice from that single entry.

- **Key = `(symbol, interval, includePrePost)`.** `adjusted` is deliberately
  **excluded** — the raw response carries both `close` and `adjclose`, so one
  entry serves price-only and total-return bases. `includePrePost` (the session)
  **is** in the key because Yahoo's raw payload differs by it. (`session` is
  currently hardcoded `regular`, so `includePrePost` is always `false` today; it
  stays in the key for forward-safety.) `period1/period2` are **not** in the key.

- **Single-flight.** A `Map<key, Promise>` collapses concurrent requests for the
  same key into one upstream fetch. The entry is cleared on settle (resolve _and_
  reject) so a failed fetch never poisons the key — the next call retries.

- **Split, interval-aware bounds.** Because the key carries no time bounds, the
  cache can't be sized by count alone — an intraday `1m` entry (~2.7k bars ≈
  0.4–0.7 MB) is ~10–100× heavier than a daily one (~280 bars ≈ tens of KB). And
  the cache is **per isolate, shared across all concurrent clients on it**, so the
  intraday working set is _not_ bounded by one request's 16 symbols — many clients
  can populate distinct `1m`/`5m` entries at once. So it is split into two LRUs:
  a small **intraday cap (`1m`/`5m`, max 32)** that bounds the heavy entries to
  ~22 MB worst case, and a generous **daily-and-longer cap (`1d`/`1wk`/`1mo`, max 96)** for the cheap ones. Both are whole-isolate budgets, not per-client. The
  cost of the smaller intraday cap is that two+ concurrent clients each sweeping a
  full 16-symbol intraday comparison can evict each other (a refetch), which is
  the intended trade for a hard memory bound.

- **Unsupported intervals bypass entirely.** The time-bound-free key is only sound
  for intervals widened to a fixed canonical window (the table above) — that fixed
  window is what guarantees a stored entry covers any later request for the key.
  Intervals we don't widen (`15m`/`30m`/`1h`, never produced by `intervalForRange`
  today) are **not cached and not single-flighted**: they pass straight through to
  Yahoo with their own bounds. Caching them would risk a second valid request
  slicing empty/unrelated bars out of the first request's window.

## Sharing & isolate semantics

**There is no per-client Worker.** A Worker is one deployment; every client's
request is routed to whatever isolate is free. A single isolate serves many
concurrent requests from many different clients, so the in-memory caches (layers
2 and 3) are shared across **all clients whose requests land on that isolate** —
not owned by any one client.

But "shared" is not "one global cache":

- Cloudflare runs **many isolates across ~300+ colos**, and spins up more under
  load. Each isolate has its **own** layer-2/3 caches with no coherence between
  them.
- Isolates are **ephemeral** — idle eviction, deploys, and memory pressure all
  recycle them, dropping the in-memory caches. The edge cache (layer 1) is the
  durable, cross-isolate layer within a colo.
- Requests are **not pinned** to a client. Even the same client's next request
  can hit a different isolate (or colo) and miss layers 2/3; the edge cache
  smooths exact repeats across isolates in a colo.

Net: cross-client reuse is **real but opportunistic**. If user A loads `AAPL/1Y`
and user B (same warm isolate) loads `AAPL/6M` seconds later, B slices from A's
cached raw — the intended win — but it's best-effort, not guaranteed. That's why
the guarantee is framed as _"within one warm isolate, at most one upstream fetch
per `(symbol, interval, session)`,"_ not "once ever."

**Is cross-client sharing safe?** Yes. The cached values are public Yahoo market
data, identical regardless of who asks, and no cache key carries user identity.
There is nothing per-user to leak. (Contrast the per-IP **throttle/rate-limiter**:
also shared isolate/edge infrastructure, but _keyed by client_, so it holds
per-client counters rather than shared state.)

## Freshness

Both in-memory layers and the edge cache use a ~60 s TTL, so a chart's latest bar
can lag up to ~60 s — acceptable for this app, and the client auto-refreshes once
a minute.

One compounding nuance: a range flip is a `MultiResponse` miss but can be a
raw-fetch **hit**, so it re-slices from a raw entry up to 60 s old and then
re-caches that for another 60 s. Worst case the latest **intraday** (`1D`/`5D`)
price can therefore lag ~2 min. Daily and longer ranges are unaffected (their
bars don't change intra-minute). Tightening the raw-fetch TTL would bound this at
the cost of hit rate; it is kept at 60 s by decision.

## Client-side cancellation

The browser cannot see the internal Yahoo calls — it only sees the request to our
Worker. To stop superseded requests from completing their round-trip (each still
counts against the per-IP budget, which runs before the caches), `load()` in
`+page.svelte` aborts the prior request via a module-scoped `AbortController` and
issues a new one on each call (and aborts on teardown). A deliberate cancel
surfaces as `AbortError` and returns silently — it never flips the error panel or
the background-refresh notice. This composes with the existing sequence guard
(only the newest response commits) and the auto-refresh overlap gate (background
polls only fire when nothing is in flight).

> **What abort does _not_ do:** it does not cancel upstream Yahoo work. SvelteKit
> doesn't thread the client request signal into `provider.getHistory`, and the
> throttle precedes the cache. **Server single-flight** (layer 3) is what dedupes
> the actual Yahoo work once requests arrive.

## Dev vs. production

- **`npm run dev` / `npm run dev:static`** run `vite dev` — a single long-lived
  Node process. There is **no edge cache**, and the one process acts as one
  "isolate," so layers 2 and 3 are effectively process-global and persist until
  restart (much stickier than production). `dev:static` additionally swaps the
  fetcher for synthetic fixtures and never touches Yahoo.
- **`wrangler dev` / `npm run preview`** run the real Worker build, so they use
  the production provider and the edge cache binding.

## File map

| Concern                                                                | File                                      |
| ---------------------------------------------------------------------- | ----------------------------------------- |
| Raw-fetch cache + single-flight + canonical window                     | `src/lib/server/cached-fetch.ts`          |
| Bounded LRU (TTL + eviction) used by layers 2 & 3                      | `src/lib/server/cache.ts`                 |
| Provider wiring (`getProvider` → `withCachedFetch(getChartFetcher())`) | `src/lib/providers/index.ts`              |
| `MultiResponse` LRU + edge cache + response assembly                   | `src/routes/api/history-multi/+server.ts` |
| In-process throttle                                                    | `src/lib/server/throttle.ts`              |
| Edge rate-limiter binding                                              | `src/lib/server/ratelimit.ts`             |
| Client cancellation / sequence guard / auto-refresh                    | `src/routes/+page.svelte`                 |
| Range → interval → period mapping                                      | `src/lib/benchmarks.ts`                   |
