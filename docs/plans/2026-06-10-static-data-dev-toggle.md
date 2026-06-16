# Plan 1 — Static-data dev toggle

- **Date:** 2026-06-10 (revised 2026-06-12 after two review rounds)
- **Status:** Proposed
- **Related:** [2026-06-10-cache-first-fetching.md](./2026-06-10-cache-first-fetching.md)

> **⚠️ Partly superseded by [2026-06-13-unified-symbol-entry.md](./2026-06-13-unified-symbol-entry.md).**
> Two assumptions below changed: (a) the `policy` field on `BENCHMARKS` was **removed** in favor of
> an explicit **`asset: 'INDEX' | 'ETF'`** (the real instrument type, no longer inferred from a
> return-basis proxy) — the fixture provider now reads `asset` directly; and (b) the chart
> endpoint's inner-join (`intersectionTimes`) was **replaced by union + forward-fill** on a common
> baseline. Where this plan says `policy` or `intersectionTimes`, read `asset` and union+LOCF.

## Background

Yahoo Finance rate-limits local/residential/VPN egress IPs: every `*.finance.yahoo.com`
path (v8 chart on `query1` and `query2`, plus `/v1/test/getcrumb`) returns HTTP 429
"Too Many Requests" and it is sticky across wifi/VPN switches. A cookie/crumb flow can't
help because fetching the crumb is itself 429'd.

`vite dev` has no edge cache and the in-process LRU resets on restart, so local dev
re-fetches Yahoo on nearly every reload — N calls per render (one per symbol) — which is
what burns through the IP's Yahoo budget. Production (`lift.grubs.cc`, Cloudflare Workers)
is fine because Workers egress from Cloudflare IP ranges that Yahoo isn't throttling, plus
the edge cache absorbs repeats.

## Goal

`npm run dev:static` serves synthetic data and **never touches Yahoo** — instant, for any
symbol and (with the session caveat below) any range. `npm run dev` stays live (real Yahoo),
unchanged. Tree-shaken out of the production bundle.

> **Scope note (review #7):** the mode is **Yahoo-independent**, not fully "offline." An
> authenticated layout still talks to Supabase via `hooks.server.ts` / `+layout.ts`.
> Disabling other external services is out of scope here.
>
> **Parity over guaranteed-non-empty for intraday (reviews #1, #4):** fixture mode mirrors
> live session boundaries rather than always returning bars. So an intraday (`1D`/`5D`)
> window that contains no trading session — e.g. `1D` on a Monday before 09:30 ET, whose
> `now − 2 day` lookback (benchmarks.ts:127) reaches only Saturday and misses Friday's
> session — returns empty, exactly as live would, and the centered "no overlapping history"
> panel shows. Likewise non-US benchmarks keep their own sessions, so cross-market intraday
> comparisons don't falsely align (README.md:21). Widening the live `1D` lookback is a
> separate live-behavior decision, intentionally **out of scope** for this fixtures plan.

## Changes

### 1. `package.json` — one new script

```json
"dev:static": "STOCK_FIXTURES=1 vite dev"
```

### 2. `src/lib/providers/fixtures.ts` (new)

A synthetic `FetchChart` fed into the **existing** `makeYahooProvider(fetcher)`, so only the
upstream bytes are fake; everything downstream (`buildResultFromChart`: windowing, adjclose
selection, volume, scope mapping) is the real code path.

**Exports:** `fixtureFetch: FetchChart` (the raw fetcher — consumed by both the provider and
Plan 2's cache decorator `withCachedFetch`, see review #4) and
`makeFixtureProvider = () => makeYahooProvider(fixtureFetch)`.

#### Deterministic curve — log-price, anchored to absolute time (reviews #2, #5)

Raw `close` is a pure function of `(symbol, absoluteUnixTimestamp)`, **not** of bar-index
within the requested window. Use a **bounded log-price** form so prices stay positive and
finite even over `MAX`, whose `period1 = 0` (Unix epoch, benchmarks.ts:151) — a linear
`1 + drift·(t−EPOCH) + waves` can cross zero/negative and was rejected for that reason:

```
seed  = hash(symbol)
close(symbol, t) = base(seed) * exp( growth(seed) * yearsSince(EPOCH, t) + boundedWaves(seed, t) )
```

- `EPOCH` is a fixed constant (e.g. `1990-01-01T00:00:00Z`, safely before any `period1`).
- `boundedWaves` is a sum of a few fixed-frequency, fixed-amplitude sines over `t`, so it is
  bounded → `close` is always finite and strictly positive for every `t ≥ 0`.

Consequence: any two requests overlapping in time return **identical raw closes** on the
shared timestamps, and the latest bar's raw price is stable across ranges. (An index-relative
curve would silently change historical and current prices whenever the range changed — the
bug this guards against.)

#### Adjustment factor — explicit as-of, bounded ≤ 1 (reviews #1, #3)

A constant `adjclose = close × k` is useless: `pctChangeSeries` (normalize.ts) re-bases every
series to its first point, so a constant multiplier cancels and adjusted vs. unadjusted curves
come out **identical** — fixture mode could never demonstrate price-only vs. total-return.

For **non-index** instruments, synthesize a cumulative dividend-style adjustment with an
**explicit as-of date** `asOf = ceil(period2 to UTC day end)` (the request's own upper bound;
the prior draft left `NOW_FIXED` undefined, which let `yearsBetween` go negative and push
`adjFactor > 1`):

```
adjFactor(t) = 1 / (1 + yield(seed) * yearsBetween(t, asOf))   // t ≤ asOf ⇒ 0 ≤ adjFactor ≤ 1
adjclose(t)  = close(t) * adjFactor(t)
```

Because the generated grid never exceeds `period2 ≤ asOf`, `yearsBetween(t, asOf) ≥ 0`
always, so `adjFactor ≤ 1` and `→ 1` at the window's latest bar — the stated property now
holds by construction. For **indices** (`asset: 'INDEX'`), `adjclose === close`.

> **Determinism scope (review #3, #5):** raw `close` is request-independent and identical
> across overlapping requests. `adjclose`, by contrast, is computed **as-of `period2`**, so a
> given bar's adjusted value shifts when the request window's end moves — **this is faithful
> to real adjusted data**, which Yahoo recomputes relative to the latest date on every fetch.
> Tests assert determinism on raw closes, and assert `adjFactor` bounds within a single
> request; they do **not** require identical adjusted closes across differently-ended windows.

#### Per-symbol metadata — explicit, not heuristic (review #2, round 1)

A heuristic "`^…` → index, else ETF/equity" mislabels the non-`^` index benchmarks
`000001.SS` and `000300.SS` (Shanghai / CSI 300) as US equities. Instead, drive metadata from
an **explicit table covering every `BENCHMARKS` entry** — `instrumentType`, `exchangeName`,
`currency`, and `exchangeTimezoneName`. Currency comes straight from `BENCHMARKS`; the instrument
type is read from the explicit **`asset`** field on each `BENCHMARKS` entry (INDEX for every index
including the `.SS` pair, ETF for the proxies) — the old `policy` field has been removed. Only
**unknown** symbols (a user-typed ad-hoc ticker) fall back to the generic default: US EQUITY,
exchange `NMS`, `USD`, `America/New_York`.

`regularMarketPrice` / `regularMarketTime` come from the last generated bar.

#### Timestamp grid — per-symbol exchange session for intraday (reviews #4, #6-r1)

Generate timestamps from `period1`→`period2` stepping by `interval`. The grid is derived from
period+interval (plus the symbol's session metadata), so symbols that share a session align on
identical timestamps under union + forward-fill (the inner-join `intersectionTimes` was replaced).

- Daily/longer (`1d`=1 day skipping weekends, `1wk`=7d, `1mo`≈30d): unchanged.
- **Intraday (`1m`=60s, `5m`=300s): emit bars only during each symbol's own weekday exchange
  session**, driven by the metadata table's `exchangeTimezoneName` and a small per-exchange
  session-hours map — e.g. US `09:30–16:00 America/New_York`, London `08:00–16:30
Europe/London`, Tokyo `09:00–15:00 Asia/Tokyo`, Shanghai `09:30–15:00 Asia/Shanghai`;
  unknown symbols use the US default. This (a) keeps payloads ~10× smaller than a 24/7 grid,
  (b) preserves the documented non-overlap of cross-market intraday comparisons
  (README.md:21), and (c) is the parity behavior described in the Goal's scope note: an
  intraday window with no in-session bars legitimately returns empty.

### 3. `src/lib/providers/index.ts` — shared fetcher selector (review #4, round 1)

So Plan 1 and Plan 2 compose, introduce one selector — `getChartFetcher()` — that is the single
source of truth for "real vs. fixture," and have `getProvider()` build on it. **Plan 1 ships the
selector and the undecorated provider; Plan 2 wraps the same selector with its `withCachedFetch`
decorator** (no second source of truth, no second provider boundary):

```ts
// yahoo.ts: export the previously-private default fetcher
export const defaultFetch: FetchChart = /* … unchanged … */;

// index.ts
export function isFixtureMode(): boolean {
  return import.meta.env.DEV && process.env.STOCK_FIXTURES === '1';
}

export function getChartFetcher(): FetchChart {
  return isFixtureMode() ? fixtureFetch : defaultFetch;
}

export function getProvider(): PriceProvider {
  // Plan 1 (this plan):  makeYahooProvider(getChartFetcher())
  // Plan 2 wraps the SAME selector:  makeYahooProvider(withCachedFetch(getChartFetcher()))
  if (!cached) cached = makeYahooProvider(getChartFetcher());
  return cached;
}
```

The `import.meta.env.DEV` guard makes Rollup tree-shake `fixtures.ts` (and `fixtureFetch`) out
of the prod bundle. When Plan 2 lands it changes only this one wiring line to
`makeYahooProvider(withCachedFetch(getChartFetcher()))` — the cache is a `FetchChart` decorator
**beneath** the provider, so the selector, the routes, and the `PriceProvider` boundary are all
unchanged. (Plan 2 deliberately does **not** add a separate `history-service` that routes call
directly; that would bypass the boundary documented in PLAN.md:167-188.)

### 4. `src/routes/api/lookup/+server.ts`

When `isFixtureMode()`, **short-circuit at the top of the handler** — before the throttle,
edge-cache, and Yahoo search `fetch` — returning a static `{ symbol, name, currency }` (name
from a small known map, falling back to the symbol; currency from `BENCHMARKS` when known else
`USD`). Reuse the exported `isFixtureMode()` helper so the flag is defined once. This is the
path the test in review #3 (round 1) pins: in fixture mode the handler must never reach `fetch`.

### 5. `README.md` — document the new workflow (review #6)

The "Run locally" section currently shows only `npm run dev`. Add `npm run dev:static`, state
its **Yahoo-independent** scope (synthetic data, no Yahoo calls; Supabase still reachable when
authed), and note the limitation that `wrangler dev` / `npm run preview` run a production build
and therefore always use the **real** provider regardless of the env var.

### 6. (optional) "Demo data" pill

A header pill when the flag is on, so synthetic is never mistaken for real. Needs the server
flag passed to the client — add it to the existing layout `load` (the auth setup already has a
server load). Skipped in v1 unless requested.

## Tests / verification

- **`fixtures.ts` unit tests:**
  - Deterministic raw closes for a fixed `(symbol, t)`; overlapping ranges return identical raw
    closes and the same latest raw price (review #5).
  - **Across a `MAX` request (`period1 = 0`), every generated `close` is finite and strictly
    positive** (review #2).
  - Correct instrument types incl. `000001.SS`/`000300.SS` as indices (review #2, round 1).
  - Intraday grids contain **no** off-session bars, and use **each symbol's own session**
    (a non-US benchmark's `1m` bars fall in its local hours, not US hours) (review #4).
  - Sane bar counts; grids align across same-session symbols.
- **Adjustment (reviews #1, #3):** within one request, `0 ≤ adjFactor ≤ 1` for all bars and the
  last bar's `adjFactor ≈ 1`; feed one fixture ETF series through `buildResultFromChart` twice
  (`adjusted: true` vs `false`), normalize each with `pctChangeSeries`, assert the two
  normalized curves **differ**; assert an index symbol's two curves are identical.
- **Selector + handler isolation (review #3, round 1):** with `STOCK_FIXTURES=1`, set
  `globalThis.fetch` to a stub that throws if called, then (a) call `getProvider().getHistory(...)`
  and the lookup `GET` handler and assert both succeed without invoking `fetch`; (b) with the
  flag unset, assert `getChartFetcher()` returns `defaultFetch`. Reset the `getProvider()`
  singleton between cases. Do **not** import `$env` — read `process.env` directly.
- **Tree-shaking is verified, not assumed (review #5):** `fixtures.ts` carries a unique
  sentinel string (e.g. `FIXTURE_BUILD_MARKER`). After `npm run build`, grep the generated
  Worker bundle (`.svelte-kit/cloudflare/_worker.js`) for that marker; **fail verification if
  it is present**. (A bare build success does not prove exclusion.)
- **Manual:** `npm run dev:static` → default set + a random ticker render across daily/longer
  ranges with **zero** Yahoo traffic; `npm run dev` still live.
- `npm test` green.

## Risks / notes

- `process.env` is server-only here (providers are never in the client bundle — confirmed),
  so no client breakage.
- Vitest: `import.meta.env.DEV` is true under test but `STOCK_FIXTURES` is unset → real
  provider by default; the fixture tests set the env var explicitly per-case and reset the
  singleton.
- Static mode is `vite dev` only (the `import.meta.env.DEV` guard). `wrangler dev` runs a
  production build, so it would use the real provider (documented in README per change #5).
- Intraday `1D`/`5D` can legitimately return empty in fixture mode (pre-session or
  cross-market) — by design, mirroring live. Daily and longer ranges always populate.
