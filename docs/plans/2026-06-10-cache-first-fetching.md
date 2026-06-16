# Plan 2 — Cache-first fetching (stop hitting the API needlessly)

- **Date:** 2026-06-10 (revised 2026-06-12 after review)
- **Status:** Implemented 2026-06-12 — `src/lib/server/cached-fetch.ts` (`withCachedFetch`),
  wired in `providers/index.ts`; client cancellation (B1) in `+page.svelte`; tests in
  `tests/cached-fetch.test.ts`. TTL kept at 60s (plan default). Behavior reference:
  [../caching.md](../caching.md).
- **Review adjustments (2026-06-13):** (1) the single `max: 96` count cap became **split
  interval-aware caps** — intraday `1m`/`5m` `max: 32`, daily+ `1d`/`1wk`/`1mo` `max: 96` —
  because the cache is per-isolate (shared across clients), so intraday memory isn't bounded
  by one request's 16 symbols; this is the "weight the cap by interval" refinement the Memory
  section flagged as optional. (2) Intervals we don't widen (`15m`/`30m`/`1h`) now **bypass**
  the cache + single-flight entirely — a time-bound-free key is only sound when a fixed
  canonical window guarantees coverage, so un-widened intervals must not be cached.
- **Related:** [2026-06-10-static-data-dev-toggle.md](./2026-06-10-static-data-dev-toggle.md)

> **⚠️ Partly superseded by [2026-06-13-unified-symbol-entry.md](./2026-06-13-unified-symbol-entry.md).**
> The unification (a) **removed the legacy `/api/history` route** — there is now only
> `/api/history-multi`; (b) replaced the `(stocks + compares + range)` cache key with
> **`(symbols + basis + range)`** (a `basis` toggle was added, the stocks/compares split was
> retired); and (c) folded `MAX_STOCKS`/`MAX_COMPARES` into a single **`MAX_SYMBOLS = 16`**.
> The **16-symbol × 5-interval = 80-key LRU sizing below stays valid** (16 is preserved exactly).
> Throughout, read "both history routes" as the single `/api/history-multi`, "stocks/compares" as
> "symbols," and `MAX_STOCKS`+`MAX_COMPARES` as `MAX_SYMBOLS`.

## Background

Sources of needless Yahoo calls in the current code:

1. **No request cancellation:** every range/selection change fires `load()`; rapid clicks
   launch overlapping HTTP round-trips. The client already **seq-guards** state so a slow
   earlier response can't overwrite a newer one (see B1 — this is done), but the superseded
   request still travels client→server and counts against the per-IP throttle, which runs
   **before** the cache lookup (history-multi/+server.ts:174 precedes :192).
2. **Whole-response caching only:** the server caches the full `MultiResponse` keyed by
   _(symbols + basis + range)_, so adding/removing one ticker or flipping range refetches
   **all** symbols from Yahoo, not just the new/changed work.
3. **No single-flight at the symbol level:** two requests needing the same `(symbol, interval)`
   both fan out to Yahoo.

The existing 60s `MultiResponse` LRU + edge cache handle _exact_ repeats, but not range/window
changes or per-symbol reuse.

## Goal

Fetch the widest window each interval needs **once** per `(symbol, interval, session)`, slice
every range from that cached raw response, and dedupe concurrent fetches — **without** moving
the routes off the `PriceProvider` boundary. Plus a client cancellation guard so superseded
requests are aborted rather than left to complete.

## Range → interval → period mapping (from `benchmarks.ts`)

| Range | `interval` | `period` (lookback) |
| ----- | ---------- | ------------------- |
| 1D    | `1m`       | ~2 days             |
| 5D    | `5m`       | ~9 days             |
| 1M    | `1d`       | 1 month             |
| 6M    | `1d`       | 6 months            |
| YTD   | `1d`       | Jan 1 → now         |
| 1Y    | `1d`       | 1 year              |
| 5Y    | `1wk`      | 5 years             |
| MAX   | `1mo`      | all time            |

## Key refinement vs. "fetch MAX"

We don't need true MAX — only the **widest range that uses each interval** (+ small buffer).
That keeps payloads tiny while still collapsing the four daily ranges into one fetch:

| interval | canonical fetch window | serves              | ~bars       |
| -------- | ---------------------- | ------------------- | ----------- |
| `1m`     | ~7 days (Yahoo cap)    | 1D                  | ~2.7k       |
| `5m`     | ~1 month               | 5D                  | ~1.7k       |
| `1d`     | ~13 months             | **1M, 6M, YTD, 1Y** | ~280        |
| `1wk`    | 5 years                | 5Y                  | ~260        |
| `1mo`    | all time (`period1=0`) | MAX                 | few hundred |

## B2 — cache + single-flight as a `FetchChart` decorator (review #3)

**Do not** add a Yahoo-specific `history-service` that the routes call directly — that bypasses
the `PriceProvider` boundary documented in PLAN.md (167-188), where routes only ever touch
`getProvider().getHistory(...)`. Instead, insert the cache **below** the provider, at the
`FetchChart` seam that `makeYahooProvider(fetcher)` already accepts.

**New `src/lib/server/cached-fetch.ts`** — `withCachedFetch(inner: FetchChart): FetchChart`:

1. **Widen to the canonical window — anchored to the request, not to wall-clock (review #3).**
   A rolling window needs a _time anchor_, not just an interval: deriving it from a fresh
   `Date.now()` can place the canonical start _after_ the caller's `period1` (an exact 5-year
   window computed a few ms late begins after the requested first bar) and silently drop it. So
   anchor to the request's own bounds, never to wall-clock:
   - `canonical.period2 = opts.period2` (+ a one-interval forward buffer so the in-progress last
     bar is covered).
   - `canonical.period1 = canonical.period2 − SPAN[interval]`, where `SPAN[interval]` is the
     **widest range that uses that interval** (the table above) **plus a buffer** (≥ one interval,
     and a few days for `1d` to absorb weekends/holidays). For `1mo`/MAX, `canonical.period1 = 0`
     (epoch), matching `benchmarks.ts:151`.
   - This **guarantees `canonical.period1 ≤ opts.period1` and `canonical.period2 ≥ opts.period2`**
     for every range that maps to the interval: by construction `SPAN[interval] ≥ (opts.period2 −
opts.period1)`, and anchoring `period2` to the request makes the start subtraction reach past
     `opts.period1`. Defensive guard: if a caller ever passes a `period1` earlier than
     `canonical.period1` (shouldn't happen given the range→interval map), widen `canonical.period1`
     **down** to `opts.period1` rather than truncate.
   - Because `SPAN[interval]` is the _widest_ range for the interval, every other range sharing it
     has `period1 ≥ canonical.period1`, so one cached entry — whichever range first populated it —
     covers them all (1M/6M/YTD/1Y all slice from one `1d` fetch).

   `buildResultFromChart` then re-slices the raw result back to the request's real
   `req.period1/period2`, exactly as today — so the widening is invisible to callers, and no
   requested bar is ever omitted.

2. **Cache key = `(symbol, interval, includePrePost)`** (review #2). `includePrePost` is the
   session: Yahoo's raw response differs by it (yahoo.ts:194 derives it from
   `req.session === 'extended'`), so it **must** be in the key. `adjusted` is correctly
   **excluded** — the raw value carries both `close` and `adjclose`, so one entry serves both
   bases.
3. **Value = raw `YahooChartResult`** (close + adjclose + volume), stored in a **bounded**
   `LRUCache` (review #4 — see Memory) with a short TTL (~60s) so today's last bar stays fresh.
   `period1/period2` are **not** in the key.
4. **Single-flight:** a `Map<key, Promise<YahooChartResult>>` so concurrent requests for the
   same key share one upstream fetch. **Clear the entry on settle (both resolve and reject)** so
   a rejected fetch doesn't poison the key — the next call retries.

**Wiring (no route changes):**

```ts
// providers/index.ts
export function getProvider(): PriceProvider {
	if (!cached) cached = makeYahooProvider(withCachedFetch(getChartFetcher()));
	return cached;
}
```

`getChartFetcher()` is the selector Plan 1 introduces (real `defaultFetch` vs `fixtureFetch`),
so the two plans compose and there is one source of truth for fetcher selection.
`makeYahooProvider` / `buildResultFromChart` are unchanged, the contract tests are untouched,
and **`/api/history-multi` keeps calling `provider.getHistory` verbatim** (the legacy
`/api/history` route was removed by the unification plan).
The decorator sits beneath the existing endpoint-level `MultiResponse` LRU + edge cache, so it
only does work when those miss (range flip, add/remove ticker) but a per-symbol raw is warm.

**Memory + working-set bound (review #4):** the hot working set is bounded by the endpoint's own
limit — a single **`MAX_SYMBOLS = 16`** per request (the old `MAX_STOCKS 8` + `MAX_COMPARES 8`,
unchanged total; now declared in `selection.ts`) — times the **5 intervals** (`1m/5m/1d/1wk/1mo`). `session` is currently
**hardcoded `'regular'`** (history-multi:103), so `includePrePost` is always `false` and the key
is effectively `(symbol, interval)` today (we still keep `session` in the key for forward-safety).
That makes the worst-case full sweep **16 × 5 = 80 distinct keys** within one TTL. **`max: 64` is
too small** — flipping through every range for a full 16-symbol comparison would evict and refetch
inside the TTL, breaking the "at most one fetch" claim. **Set `max: 96`** so the entire 80-key
worst case fits with headroom for transient churn.

Resident bytes are dominated by the heavy intraday entries: a `1m` entry holds ~2.7k `YahooQuote`
objects (each a `Date` + 3 numbers ≈ 150–250 B in V8) → ~0.4–0.7 MB; `5m` ~1.7k bars;
daily/weekly/monthly entries are ~280 bars ≈ tens of KB. But **only one range is active per symbol
at a time**, so at most ~16 entries are ever `1m`/`5m` simultaneously (the symbols on screen at an
intraday range) ≈ ~8–11 MB; the other (up to 80) entries are the cheap daily-and-longer ones. So
even at `max: 96` the realistic resident footprint is low-tens of MB, **not** `96 × 0.7 MB`.
**Aggregate check (review #4):** alongside this raw cache sits the endpoint `MultiResponse` LRU
(`max: 200`, history-multi:58); `cache.ts`'s 500-entry default is **overridden** here, not
additive. Total stays comfortably within a Workers isolate. Eviction is covered by a test (below),
not assumed.

> Optional refinement (not v1): if intraday memory ever pressures the isolate, weight the cap by
> interval (a small sub-cap on `1m`/`5m`) rather than a single count-based `max`.

## B1 — client cancellation (`src/routes/+page.svelte`)

**The seq-guard is already implemented, and every state mutation is already re-checked _after_
each `await`** (review #1 — verified against current code; line numbers below, which the prior
draft had stale). Concretely, inside `load()`:

- **success** commits behind `if (seq !== loadSeq) return;` at `:338` — after `await r.json()`,
  before `data = next`.
- **the `!r.ok` error path reads the body first, _then_ re-checks before mutating:**
  `const body = await r.text();` (`:331`) → `if (seq !== loadSeq) return;` (`:332`) →
  `loadError = describeError(...)` (`:333`). This is **exactly** the pattern the review #1
  recommends (`raw = await r.text(); if (seq !== loadSeq) return; loadError = …`) and it is
  **already present**, so no code change is needed here. (The earlier claim that this branch was
  "guarded by the early return at `:313`" was wrong — `:313` only clears state inside the
  foreground `if (!background)` block; the real guard is the **post-body re-check at `:332`**.)
- the **`catch`** re-checks at `:345`; **`finally`** clears `loading` only when
  `seq === loadSeq && !background` (`:358`).

So no commit point can be reached with a stale `seq`, even after a buffered body read. **Do not
re-add or "fix" this.**

The remaining gap is purely **cancellation** — `fetch(u)` (`:321`) is issued with no signal, so a
superseded request still completes its round-trip (and still buffers its body before the re-check
discards it):

- Add a module-scoped `let inflight: AbortController | null = null`.
- At the top of each `load()`: `inflight?.abort(); inflight = new AbortController();` and pass
  `{ signal: inflight.signal }` to `fetch`. Aborting interrupts the in-flight `await r.text()` /
  `await r.json()` body read, so a cancelled response never even reaches its `seq` re-check.
- In `catch`, **return silently on `AbortError`** (`if (e?.name === 'AbortError') return;`)
  **before** the `seq !== loadSeq` check at `:345`, so a deliberate cancel never flips
  `refreshFailed` or shows the error panel.
- In **`onDestroy` (`:549`), call `inflight?.abort()`** so a teardown mid-flight doesn't leak a
  pending request.
- This composes with the auto-refresh overlap guard (`maybeAutoRefresh` polls only when
  `inFlight === 0`, `:381`): a user action aborts an in-flight background poll (desirable), and
  background polls never abort a foreground load.

**Honest effect (review #1):** abort + the existing seq-guard stop stale UI and stop superseded
requests from completing. They do **not** cancel upstream Yahoo work — SvelteKit endpoints don't
thread the request signal into `provider.getHistory`, and the throttle precedes the cache. If we
want to also avoid _issuing_ superseded HTTP requests, briefly debounce/coalesce rapid selection
changes (optional, noted below). Server single-flight (B2) is what dedupes Yahoo work once
requests arrive.

## Scope of the win (reviews #4, #6)

Within one warm server isolate, **and within the cache's capacity (`max: 96`) and TTL**, each
`(symbol, interval, session)` causes **at most one** upstream Yahoo fetch; all four daily ranges
and both adjusted/unadjusted bases slice from that single entry. The `max: 96` cap is sized to
hold the full 16-symbol × 5-interval worst case (see Memory bound), so a normal comparison never
self-evicts inside the TTL. Fetches **can recur** when (a) the TTL expires (~60s), (b) the isolate
is evicted, or (c) **the live hot-key set exceeds `max`** — capacity eviction is real, just kept
out of the normal envelope by the sizing above. Exact repeats are additionally absorbed by the
endpoint `MultiResponse` LRU + edge cache. This is a large reduction in steady state — not a
literal "once ever per symbol."

## Tests / verification (review #7)

Unit tests for `withCachedFetch`, driving a **spy `FetchChart`** (counts calls, records the opts
it was handed):

- **Sub-range hit:** two requests with different `period1/period2` but the same
  `(symbol, interval, session)` → inner fetcher called **once**; both get the full raw window.
- **Canonical upstream window:** assert the inner fetcher is called with the **widened canonical**
  `period1/period2` for the interval, not the caller's narrow range.
- **Boundary coverage (review #3):** a request whose `period1` is exactly the interval's widest
  documented lookback (e.g. `1Y` on `1d`, `5Y` on `1wk`) still yields its **first** bar after
  slicing — i.e. `canonical.period1 ≤ opts.period1` with no off-by-one omission. Include a case
  where `opts.period2` is "now-ish" to prove the anchor is `opts.period2`, not a stale `Date.now()`.
- **Session separation:** `session: 'regular'` vs `'extended'` (→ `includePrePost`) produce
  **distinct** keys → two fetches.
- **Single-flight:** two concurrent calls for one key → inner called once; **rejection-then-retry:**
  if the in-flight promise rejects, the key is cleared and the next call fetches again (no poisoned
  entry).
- **TTL expiry:** with fake timers, advance past TTL → next call refetches.
- **Eviction:** exceed `max` distinct keys → oldest evicted (refetched on next access), proving the
  bound.
- **Singleton wiring:** `getProvider()` returns a provider whose fetcher is the decorated one
  (e.g. a second `getHistory` for an overlapping range issues no new spy call).
- **Adjusted + unadjusted from one entry:** `adjusted: true` and `false` for the same key →
  inner called once; both bases correct via `buildResultFromChart`.
- **Manual:** instrument the spy / a server-side counter (the **browser network panel can't see
  internal Yahoo calls** — it only sees the call to our endpoint); flip 1M↔6M↔YTD↔1Y and confirm
  one upstream fetch per `(symbol, interval, session)`; rapid clicking never flickers/stales.
- `npm test` + `npm run check` + `npm run build` green.

## Risks / notes

- **Freshness:** last bar can lag up to the TTL (~60s) — acceptable; tune if tighter is wanted.
- **Memory:** bounded by the `max: 96` entry cap + LRU eviction (see B2), sized to the 16-symbol ×
  5-interval working set; resident bytes are dominated by the few on-screen intraday entries, not
  by the cap.
- **Boundary preserved:** the cache is a `FetchChart` decorator beneath `makeYahooProvider`, so
  routes, the `PriceProvider` interface, and the contract tests are all unchanged.
- **Optional — debounce:** a short (~150ms) coalesce on rapid selection changes would stop
  superseded HTTP requests from being issued at all; left out of v1 since abort + single-flight
  already bound the cost.
- **Optional future reduction:** downsample the daily series into weekly/monthly to drop the
  `1wk`/`1mo` fetches too (one daily fetch per symbol). Left out of v1.
