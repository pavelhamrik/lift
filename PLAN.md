# Lift — build plan

A small web app to compare a stock against a benchmark (default: S&P 500) on
price, with the target's volume shown in a sub-pane. Local-first; will
deploy to Cloudflare Workers (Static Assets) later, with the public
endpoint hardened.

## Stack

| Concern         | Choice                                                              |
| --------------- | ------------------------------------------------------------------- |
| Framework       | SvelteKit (Vite, TypeScript)                                        |
| Chart           | TradingView Lightweight Charts                                      |
| Data provider   | Yahoo (via `yahoo-finance2`), abstracted                            |
| Styling         | Tailwind v4 + shadcn-svelte                                         |
| Theme modes     | dark / light / system (default system)                              |
| Tests           | Vitest                                                              |
| Hosting (later) | Cloudflare Workers — Static Assets (`@sveltejs/adapter-cloudflare`) |

Why these:

- **SvelteKit** — reactive without the React `useEffect` footguns; server
  routes give us a clean place to hide provider details + harden the public
  endpoint.
- **Lightweight Charts** — built for finance, looks great by default,
  native sub-pane support for volume. Attribution required on public pages
  (release-checklist item).
- **`yahoo-finance2`** — keyless, supports both `SPY` and `^GSPC` for
  S&P 500 benchmarking (we default to SPY for symmetric total-return
  semantics — see Adjustment policy). Public-shareable. Unofficial;
  mitigated by the provider abstraction.
- **Workers Static Assets, not Pages.** Cloudflare Pages Functions
  supports only a subset of bindings, and the **Workers Rate Limiting
  binding is not in that subset** (verified against
  `developers.cloudflare.com/pages/functions/bindings`). Since the rate
  limit binding is the v1 production abuse boundary, we deploy to
  Cloudflare Workers (Static Assets) instead — same SvelteKit adapter,
  full Workers binding surface, current CF-recommended path.

## File layout

```
src/
  lib/
    providers/
      types.ts        # PriceProvider, HistoryRequest/Result, Bar, Range
      yahoo.ts        # Yahoo implementation
      index.ts        # getProvider() — currently always Yahoo
    chart/
      setup.ts        # chart init, theme application
      normalize.ts    # pct-change, time-alignment (inner-join)
    server/
      cache.ts        # bounded LRU + TTL
      throttle.ts     # per-IP sliding-window
      validate.ts     # symbol + range canonicalization
    theme/
      mode.ts         # dark/light/system store, persisted
  routes/
    api/
      history-multi/
        +server.ts    # GET /api/history-multi?symbols=…&basis=…&range=…
      search/
        +server.ts    # GET /api/search?q=…       (autocomplete)
      lookup/
        +server.ts    # GET /api/lookup?symbol=…  (exact resolve)
    +page.svelte      # the UI
    +layout.svelte    # font, mode-watcher, root data-theme attribute
tests/
  normalize.test.ts
  validate.test.ts
  cache.test.ts
  align.test.ts
  summary.test.ts                  # summary metrics derive from aligned series
  providers/
    contract.test.ts               # runs a shared suite against every PriceProvider,
                                   # fed by the full recorded fixtures below:
                                   # canonical Bar/HistoryResult shape, monotonic
                                   # bars across the full series (not just endpoints),
                                   # identical interval/session/adjusted for paired
                                   # target+benchmark fetches (so the comparison stays
                                   # on one return basis), canonical InstrumentMeta
                                   # for each of: known equity, ETF, index benchmark,
                                   # dotted-class equity (e.g. BRK.B — exercises the
                                   # symbol-normalization path the regex admits)
    yahoo.fixtures.test.ts         # pinned fixtures for ^GSPC, SPY, AAPL, BRK.B —
                                   # full recorded yahoo-finance2 responses (raw
                                   # provider payloads). Tests replay the real
                                   # provider mapping over the recorded payload, so
                                   # middle-of-series mapping bugs surface; first/last
                                   # bar summaries kept alongside as PR-review aids only
```

## Provider interface

```ts
// src/lib/providers/types.ts
export type Range = '1D' | '1Y';
export type Interval = '1m' | '5m' | '1d';

// v1 charts normalized closes + target volume only — model accordingly.
// Mixing adjusted close with raw OHL is incoherent; if we ever need real
// candles, add a separate `ohlc?: { open; high; low; close }` (raw) field.
export type Bar = {
	time: number; // unix seconds, UTC
	close: number; // adjusted if HistoryResult.adjusted=true, else raw
	volume: number;
};

export type SessionPolicy = 'regular' | 'extended';

// User-facing `(range, benchmark)` is mapped to a HistoryRequest by the
// server route. Interval/session come from the range; `adjusted` comes
// from the benchmark's adjustment policy (see "Adjustment policy is a
// property of the benchmark"). The provider boundary never sees range
// or benchmark — it only sees what to fetch. This keeps invalid combos
// (e.g. `range: '1Y'` with `interval: '1m'`, or asymmetric adjustment
// between target and benchmark) unrepresentable below the route.
export type HistoryRequest = {
	interval: Interval;
	session: SessionPolicy;
	adjusted: boolean;
};

// App-owned canonical metadata. Providers translate their native shape
// (e.g. Yahoo's `exchange: 'NMS'`, `quoteType: 'EQUITY'`) into these
// values inside the provider module — the rest of the app never sees raw
// provider strings, so swapping providers doesn't change the validation
// surface in routes or tests.
export type Country = 'US' | 'OTHER';
export type Asset = 'US_LISTED_EQUITY' | 'US_LISTED_ETF' | 'US_INDEX' | 'OTHER';

export type InstrumentMeta = {
	country: Country;
	asset: Asset;
};

// Server-internal — the provider returns this, the route consumes it
// for alignment/summary, but it is **not** serialized to the client.
// The wire contract is `HistoryResponse` (see Server route). Kept
// provider-agnostic by construction so swapping providers doesn't
// ripple through the alignment/summary logic that consumes it.
export type HistoryResult = {
	symbol: string; // canonical, provider-independent (e.g. "^GSPC")
	currency: string; // ISO 4217, e.g. "USD"
	timezone: string; // IANA, e.g. "America/New_York"
	interval: Interval;
	session: SessionPolicy;
	adjusted: boolean; // true if close is split/dividend adjusted
	meta: InstrumentMeta; // used for in-scope checks (see Validation)
	bars: Bar[];
	// Latest traded price + its timestamp. On 1d this is yesterday's close;
	// on 1m intraday it can be newer than the last aligned-window bar
	// (which is why we keep this separate from windowed metrics — see
	// server-route summary contract).
	lastPrice: number; // unadjusted
	lastPriceTime: number; // unix seconds, UTC
};

// Server-internal — never serialized to the client. Carries the raw
// query the provider issued so we can correlate logs and reproduce
// failures, but providerSymbol shape (e.g. "%5EGSPC") would otherwise
// leak Yahoo specifics into the public API contract.
export type ProviderTrace = {
	providerName: string; // e.g. "yahoo"
	providerSymbol: string; // what we actually queried (e.g. "%5EGSPC")
};

export interface PriceProvider {
	name: string;
	// Returns the public result plus a server-internal trace. The route
	// serializes only `result`; `trace` goes to logs.
	getHistory(
		symbol: string,
		req: HistoryRequest
	): Promise<{ result: HistoryResult; trace: ProviderTrace }>;
	// Optional: capability surface for tests/swaps.
	supports(req: HistoryRequest): boolean;
}
```

`src/lib/providers/index.ts` exports `getProvider()` that today returns the
Yahoo implementation. The provider's job is to (a) translate canonical
symbols into provider-specific queries, (b) translate raw provider
metadata into the canonical `InstrumentMeta` enums above, and (c) return
bars in the canonical `Bar` shape. Swapping providers means writing a new
file with the same translation responsibility; routes, validation, and
tests stay unchanged because they only deal with canonical types.

(That said: provider migrations will still need fixture updates and a
contract test pass, since canonical-shape conformance is what the
abstraction actually buys you. The "new file + one-line change" claim
applies to the _call sites_, not to verifying the new provider behaves.)

The caller (server route) maps user-facing `(range, benchmark)` to a
`HistoryRequest` once, then forwards only the request to the provider.
**Adjustment is a property of the benchmark, not the range**, to keep
target and benchmark on the same return basis — see the next subsection.

| Range | Interval | Session |
| ----- | -------- | ------- |
| 1D    | `1m`     | regular |
| 1Y    | `1d`     | regular |

Both target and benchmark are fetched with **identical** `HistoryRequest`
— same interval, same session, **same `adjusted`** — so their bars are
pre-aligned to the same trading session and the same return basis, then
inner-joined on timestamps before normalization (see Normalization &
alignment).

### Adjustment policy is a property of the benchmark

Adjusted close (Yahoo's `Adj Close`) folds dividends and splits into the
price series, so it represents _total return_. Raw close represents
_price-only return_. **Asymmetric adjustment between target and
benchmark systematically biases the comparison.** Concretely:

- `^GSPC` is the S&P 500 _price index_. It has no dividend stream of its
  own (constituents pay dividends, the index does not) and no splits
  (constituent splits are absorbed into the index divisor). So Yahoo's
  `Adj Close` for `^GSPC` is _identical_ to its `Close`.
- An individual US stock like `AAPL` has dividends and (historically)
  splits, so its `Adj Close` is meaningfully different from `Close`
  over a year.

Fetching `AAPL` with `adjusted=true` against `^GSPC` with `adjusted=true`
means AAPL's series carries dividend reinvestment while `^GSPC`'s does
not. The headline % change overstates stock outperformance — opposite
of what an honest "stock vs S&P 500" comparison should show.

The fix: bind adjustment to the benchmark entry, and apply the same
value to both sides:

```ts
const BENCHMARKS = {
	// Price-only S&P 500 index. Adj Close ≡ Close on Yahoo, so on 1Y we
	// fetch raw close for both target and benchmark — price-only on both
	// sides, symmetric.
	'^GSPC': { label: 'S&P 500 index (^GSPC)', policy: 'price-only' },
	// Dividend-bearing ETF. Adj Close incorporates SPY's distributions,
	// so 1Y fetches adjusted close on both sides — total return on both,
	// symmetric. This is the default because it matches what most users
	// see in brokerage apps as "annual return."
	SPY: { label: 'S&P 500 ETF (SPY)', policy: 'total-return' }
} as const;
```

Labels are instrument-focused on purpose. The _return basis_ that
actually shows on the chart is a function of `(range, benchmark)`, not
the benchmark alone (see below), so authoritative basis copy lives on
the rendered window label, not on the selector option.

Route derives `adjusted` from `(range, benchmark)`:

- **1D** (1m intraday): `adjusted=false` regardless of benchmark. Within
  one trading day there are no dividends and no splits to apply, so the
  distinction is moot; provider treatment of intraday adjusted bars also
  varies, and raw close is safest.
- **1Y** (1d): `adjusted = (BENCHMARKS[bench].policy === 'total-return')`.

And the **effective return basis** rendered to the user is just a
relabeling of the same fact:

```ts
function effectiveReturnBasis(
	range: Range,
	bench: keyof typeof BENCHMARKS
): 'price-only' | 'total-return' {
	if (range === '1D') return 'price-only';
	return BENCHMARKS[bench].policy;
}
```

This value is what the UI window label shows ("1Y · regular · total
return"), so picking SPY on 1D doesn't make us claim "total return" in
the header while we're actually rendering raw intraday price. The
selector option says _which instrument_ you're comparing against; the
window label says _which basis_ the current comparison is on. They can
disagree (1D forces price-only), and that's fine as long as the UI
shows the truth.

If we later add other benchmarks (`^NDX` vs `QQQ`, `^DJI` vs `DIA`,
etc.), they're handled by setting the policy field — no asymmetric
adjustment leaks back in.

## Server route

> **Superseded.** The live chart endpoint is now
> `GET /api/history-multi?symbols=AAPL,SPY&basis=total&range=1Y` — one ordered
> `symbols` list (no target/benchmark split), an explicit `basis` toggle, union +
> forward-fill alignment, and a per-series `kind`/`asset`. See
> `docs/plans/2026-06-13-unified-symbol-entry.md`. The single-pair shape below is
> retained as historical design context.

`GET /api/history?symbol=AAPL&benchmark=SPY&range=1Y`

Public response (thin client contract — only what the page renders):

```ts
// Close-only comparison point. The price overlay needs `time` + `close`;
// it doesn't need volume on either series. Volume lives on its own
// (target-only) field below, so the wire payload carries one canonical
// source of target volume and zero benchmark volume.
type ClosePoint = { time: number; close: number };

type HistoryResponse = {
	// The chart's source of truth. No other client-visible series.
	aligned: { target: ClosePoint[]; benchmark: ClosePoint[] };
	// Target-only volume sub-pane data, on the **target's own time index**
	// — not the inner-join intersection used for the price comparison.
	// The volume pane is labeled "target's volume" in the UI, so we ship
	// the target's true bars; tying it to the intersection would silently
	// zero out a real volume bar whenever the benchmark happened to be
	// missing that same timestamp (a real edge-of-window case). The chart's
	// time scale is shared, so volume bars at intersection-gap timestamps
	// render fine — the price overlay simply has a gap at those instants.
	targetVolume: { time: number; volume: number }[];
	meta: {
		target: { symbol: string; currency: string; meta: InstrumentMeta };
		benchmark: { symbol: string; currency: string; meta: InstrumentMeta };
		interval: Interval;
		session: SessionPolicy;
		timezone: string; // common timezone for the session
		windowStart: number; // unix s, UTC
		windowEnd: number; // unix s, UTC
		// The basis the comparison is actually rendered on, derived by the
		// route from (range, benchmark) — see `effectiveReturnBasis()`. The
		// UI window label reads this rather than inferring from the
		// benchmark's selector label, so 1D + SPY correctly shows
		// "price-only" even though SPY's policy is total-return.
		returnBasis: 'price-only' | 'total-return';
	};
	summary: {
		target: { lastPrice: number; lastPriceTime: number; pctChange: number };
		benchmark: { lastPrice: number; lastPriceTime: number; pctChange: number };
	};
};
```

Server keeps the full provider `HistoryResult` (with raw `bars`) and the
`ProviderTrace` in-memory for the duration of the request — for the
alignment/summary computation and for logging — but they are **not**
serialized to the client. Reasons to keep the wire payload thin:

- One canonical comparison series on the wire = no second client-side
  data path to drift from chart semantics.
- Smaller cache entries (`caches.default` is data-center-local; small
  responses cache more usefully) and lower bandwidth.
- Easier to evolve provider internals without changing the public contract.

Two separate concepts in `summary`, deliberately not collapsed:

- **`pctChange`** is computed from the **aligned** series
  (`(aligned[last].close - aligned[0].close) / aligned[0].close * 100`),
  so the header number and the chart endpoints always agree.
- **`lastPrice` / `lastPriceTime`** are the raw latest traded price and
  its timestamp, independent of the comparison window. On 1D with 1m
  bars, `lastPriceTime` can be newer than `windowEnd` (e.g. if the
  benchmark's last bar dropped during inner-join). UI must show the
  windowed % change against the windowed series, and "last price" with
  its own timestamp — never compute a % from `lastPrice` and an
  aligned-window anchor.

Hardening — split between in-process (best-effort, dev/local) and edge
(production abuse boundary):

**In-process (optimization, not security):**

- **Canonicalize, then validate.** Order matters. _First_ trim and
  uppercase the inbound `(symbol, benchmark, range)` to produce the
  canonical form. _Second_ validate that canonical form against:
  symbol regex `^[A-Z\^.\-]{1,8}$`, range whitelist `{1D, 1Y}`,
  benchmark allowlist (see In-scope check). The ticker input is free
  text, so `aapl` and `  AAPL  ` must both be accepted — they normalize
  to `AAPL` and then validate. Anything that fails the canonical-form
  check → 400. If validation ran first, those inputs would 400 before
  ever being normalized, and the cache-key rationale below would never
  see the variants it claims to collapse.
- **Cache key from the canonical form.** That same canonical
  `(symbol, benchmark, range)` produces a single canonical cache key
  string and a canonical `Request` URL (sorted query params, fixed
  path). Both the in-process LRU and the Worker `caches.default` key
  off this canonical form — never off the raw inbound request — so
  case/whitespace/param-order variants collapse into one entry instead
  of fanning out into duplicate Yahoo fetches and inflating cache-hit
  rates on paper while missing them in practice.
- **Bounded cache.** LRU, max 500 entries, 5-min TTL. Reduces upstream
  hits per isolate. On Workers each isolate has its own memory, so this
  is opportunistic — not a global cap.
- **Per-IP throttle (in-process).** Sliding-window: 30 req / minute.
  Useful in `vite dev`. On Workers it sees only the requests routed to
  that isolate, so it cannot bound global abuse — see edge controls below.
- 4xx for unknown ticker / validation; 5xx + structured log on provider
  failure (no provider response leakage to client).

**Edge (primary controls once on CF Workers — not absolute):**

- **Cloudflare Workers Rate Limiting binding** in front of the route —
  the primary per-IP control. (This binding is supported on Workers but
  _not_ on Pages Functions — see Stack notes for why we chose the
  Workers Static Assets target.) Important caveats per Cloudflare's docs:
  it's _local to each Cloudflare location_ and _eventually consistent_,
  so it is not a strict global cap; and IP-based keys produce false
  positives for NAT/CGNAT/corporate users sharing one egress IP. So:
  - Set the limit generously enough that a small office on one IP
    doesn't hit it for normal use.
  - Plan to monitor 429 rates and per-IP volumes (CF analytics) and
    tune from data, not from guesses.
  - Treat this as raising the cost of abuse, not as authoritative
    enforcement.
- **Edge cache (Worker-generated, so explicit).** Cloudflare does _not_
  automatically cache Worker-generated responses based on
  `Cache-Control` headers; per CF docs, "the Cache API is the only
  option to customize caching" for Workers without a backend origin.
  So:
  - In `+server.ts`, after validation/canonicalization, build a
    `cacheKey: Request` from the canonical params (not the raw inbound
    request — see Canonicalization) and do
    `caches.default.match(cacheKey)` first. On miss, run the provider +
    alignment + summary, then `caches.default.put(cacheKey,
response.clone())` with a 60s TTL via the response's
    `Cache-Control` (only meaningful inside the Cache API call). Keying
    off the raw request would let lowercase symbols, surplus whitespace,
    or reordered params miss the cache and re-hit Yahoo, undermining the
    whole abuse-mitigation story.
  - **`caches.default` is data-center local** (per CF docs), not global.
    Each PoP gets its own cache. So the realistic story is "per-PoP
    cache hit absorbs repeat reads from that region" — not a globally
    deduped fetch. Combined with the per-isolate LRU, they are layered
    optimizations of the same kind.
  - **No `stale-while-revalidate`.** The Cache API isn't documented to
    honor SWR directives — drop it from the policy and don't pretend it
    works. If we ever need real SWR semantics, the path is to put the
    cacheable upstream call behind a real subrequest URL where CF's
    normal HTTP caching applies (see Risks).
  - We still set `Cache-Control: public, max-age=0, s-maxage=60` on the
    response so any CDN/intermediary that _does_ honor it behaves
    correctly; just don't count on it doing the work.
- Optional but cheap: WAF rule rejecting requests with no `Accept` header
  / non-browser UA patterns if abuse appears.
- **Fallback if we ever do need Pages.** The Rate Limiting binding can
  be replaced by a Durable Object counter (supported on Pages Functions)
  or a service binding to a small companion Worker that owns the
  binding. Both are more code than just choosing Workers up front.

**In-scope instrument check — two paths, because user-input and
shipped-benchmark have different risk profiles:**

- **Benchmark (we ship the list).** Symbol must be a key in the
  curated `BENCHMARKS` map (see "Adjustment policy is a property of the
  benchmark"). Each entry carries a label and an adjustment policy that
  the route uses to derive the `adjusted` flag for _both_ sides of the
  fetch — guaranteeing symmetric return basis. The UI exposes this as a
  selector, not free text (see UI section), so the request can never
  carry an unsupported benchmark. Whenever we add a benchmark to the
  shipped list, snapshot its canonical `meta` from a real provider
  response and pin it in a fixture test.
- **Target (user-supplied).** Require `meta.country === 'US'` AND
  `meta.asset ∈ { US_LISTED_EQUITY, US_LISTED_ETF }`. The provider is
  responsible for mapping its raw metadata into these canonical values
  (Yahoo: `exchange ∈ {NMS, NYQ, NGM, NCM, PCX, ASE, BATS}` +
  `quoteType ∈ {EQUITY, ETF}` → `US_LISTED_EQUITY`/`US_LISTED_ETF`;
  anything else → `OTHER`). The route checks canonical enums only; the
  exchange-string set is provider-internal and best-effort, expandable
  as we hit false rejections. Anything failing the check → 4xx with a
  clear error.

## Normalization & alignment

1. **Inner-join on timestamps.** `aligned.target` and `aligned.benchmark`
   share the same time index — drop any timestamp present in only one
   series. This is the source of truth for the chart.
2. **Pct change from first aligned bar:**
   `(close[i] - close[0]) / close[0] * 100`. Both series start at 0%.
3. **Volume:** target only, raw bars in a sub-pane below price.
   Volume bars run on the **target's own timestamps**, not the inner-
   join intersection — the pane is "the target's volume," so a real
   bar must not vanish just because the benchmark was missing that
   timestamp. The price overlay (above) is still inner-joined and can
   show a gap at an edge-of-window instant; the volume bar at that
   instant still renders correctly on the shared time scale. No
   benchmark-volume overlay (apples-to-oranges: a single stock's share
   volume is not comparable to an index's aggregate volume, and
   first-bar normalization picks an arbitrary baseline). If we want a
   comparable volume metric later → relative volume vs each
   instrument's own 20-day MA (rVol).

## UI (single page)

- Header strip
  - Target ticker input (free text, validated)
  - Benchmark **selector** over the curated benchmark allowlist
    (default **`SPY`**, with `^GSPC` as the alternative). Labels in
    the selector come from `BENCHMARKS[key].label` and are
    **instrument-focused** (e.g. "S&P 500 ETF (SPY)") — they identify
    _which thing_ you're comparing against, not the return basis. The
    basis depends on `(range, benchmark)`, and is rendered on the
    window label below. Not a free-text input — the backend only
    accepts curated benchmarks, so a free-text field would advertise a
    capability we don't have.
  - Range toggle: **1D** / **1Y** (default 1Y)
  - Refresh button
  - Theme toggle: **System** / **Light** / **Dark**
- Summary row, **all derived from `summary`/`meta` in the API response**
  so the number next to the chart never disagrees with the chart itself:
  - symbol
  - last price (`lastPrice`, with `lastPriceTime` shown subtly e.g.
    "as of 15:42 ET" — unadjusted, what a quote screen shows)
  - % change for the comparison window (`pctChange`, from aligned series)
  - **window label** that combines range, session, and `meta.returnBasis`
    — e.g. "1Y · regular session · total return" when 1Y + SPY,
    "1D · regular session · price-only" when 1D + SPY (intraday forces
    price-only regardless of benchmark policy — see Adjustment policy),
    "1Y · regular session · price-only" when 1Y + ^GSPC. The basis
    label always reflects what the chart is actually rendering.
- Chart fills the rest:
  - Top pane: price overlay (target + benchmark, normalized %)
  - Bottom pane: target's volume bars (raw)
- TradingView attribution displayed below the chart (release requirement)
- States: loading skeleton, inline error for invalid ticker

## Theme handling

- Persisted store in localStorage with values `system | light | dark`
- Default `system`, listens to `prefers-color-scheme` changes when in
  system mode (no manual reload needed)
- Applied as `data-theme` on `<html>`; CSS variables drive both app and
  chart colors. Chart palette swaps via `applyOptions` on theme change
  (no chart reinit).
- **First-paint / no-flash.** Inline a tiny synchronous script in
  `app.html` (`<head>`, before any stylesheet that branches on
  `[data-theme=...]`) that reads `localStorage` (or `prefers-color-scheme`
  when value is `system`) and sets `data-theme` on `<html>` before the
  first paint. Without this, SSR HTML ships with a default theme and the
  client snaps to the chosen one after hydration → visible flash. The
  Svelte store still drives subsequent updates; the inline script just
  wins the first frame.
  - **CSP note (followup).** This is an inline `<script>`, so a strict
    CSP would need either `'unsafe-inline'` (don't) or a per-build
    `script-src` hash / nonce. If/when we add CSP, generate a SHA256
    hash of the bootstrap script at build time and inject it into the
    `Content-Security-Policy` response header.

## Default symbols

- Benchmark: **`SPY`** (S&P 500 ETF, total-return semantics). It's the
  default because it pairs symmetrically with adjusted-close target data
  on 1Y — both sides reflect dividend reinvestment, matching what most
  users see in a brokerage app as "annual return." README notes `^GSPC`
  as the price-only alternative (S&P 500 price index, no dividend leg);
  selecting it forces `adjusted=false` on both sides so the comparison
  stays symmetric, just on a price-only basis.

## Build steps (in order)

1. Scaffold: `npx sv create .` → minimal template, TypeScript, Prettier,
   ESLint, Vitest (via add-ons). `npm i`.
2. Deps: `npm i yahoo-finance2 lightweight-charts`.
3. Styling: Tailwind v4 + shadcn-svelte init (per their CLI). Theme
   tweaks: pick non-default radius, font, accent so the app reads as
   distinct rather than stock-shadcn.
4. Provider module: types (`HistoryResult`), Yahoo impl, selector.
5. Server utilities: `validate` (regex + allowlist), `cache` (LRU+TTL),
   `throttle` (in-process), instrument-scope check.
6. API route wiring: canonicalize → validate → throttle → cache →
   provider → scope-check → align → summarize. Set `Cache-Control`
   response headers.
7. Chart utilities: setup, normalize, inner-join alignment.
8. Theme store + layout integration; inline no-flash script in
   `app.html`.
9. Page UI: form, fetch, render, loading + error states.
10. Style pass: layout polish, summary header, chart palette per theme.
11. Tests:
    - Unit: validation, normalization, alignment, cache eviction,
      summary-from-aligned consistency, public-response-shape (no raw
      `bars` leak).
    - **Provider contract suite (offline, blocking gate).** Run the
      shared `PriceProvider` contract suite against a recorded-response
      stub fed by the pinned fixtures. This is what blocks PR merges,
      so an unrelated PR is never red because Yahoo had a bad minute.
      Asserts canonical `Bar`/`HistoryResult` shapes, monotonic
      timestamps, matching interval+session for paired fetches, and
      canonical `InstrumentMeta`.
    - **Provider fixtures** — for `^GSPC`, `SPY`, `AAPL`, and **`BRK.B`**,
      store the _full_ recorded `yahoo-finance2` response (the raw
      provider payload, not just the canonical output it would produce).
      Fixture set rationale:
      - `^GSPC` — index benchmark, price-only adjustment policy.
      - `SPY` — ETF benchmark, total-return adjustment policy.
      - `AAPL` — plain US-listed equity with both historical splits
        and dividends; exercises the adjusted-close mapping.
      - `BRK.B` — dotted-class share. The validation regex
        `^[A-Z\^.\-]{1,8}$` admits `.`, so class-share names are an
        in-scope input class; without a fixture, the provider's
        symbol-normalization path (e.g. dot-vs-dash, class-share
        encoding) is uncovered by the blocking suite and a normalization
        regression on a real user input would only surface in the
        non-blocking live smoke. If we ever decide v1 won't support
        class shares, narrow the regex to drop `.` and remove this
        fixture — but the regex and the fixture set must stay in sync.
        The contract suite replays the real provider mapping over the
        recorded payload, so it can assert full-series invariants
        (monotonic timestamps across every bar, no nulls/NaN closes
        mid-series, the `InstrumentMeta` translation path, the symbol
        normalization path) — not just endpoint snapshots. Mid-series
        mapping bugs that don't move first/last would otherwise slip
        through. First/last bar summaries are kept as a human-readable
        PR-review aid (so a reviewer can eyeball "still 2024-01-02 →
        2024-12-31" without diffing thousands of bars), but the gate runs
        over the full payload. Refresh via `npm run fixtures:refresh`;
        review the diff in PR.
    - **Live-provider smoke (non-blocking, scheduled).** A separate job
      runs the contract suite against the _real_ Yahoo endpoint on a
      cron (e.g. daily) and as a non-blocking post-deploy check. When
      it fails it pings me, but it doesn't break PR CI. This is the
      Yahoo drift detector that matters operationally.
12. `.gitignore`, `README.md` (run instructions + attribution note),
    first git commit.
13. **Pre-deploy (CF Workers Static Assets):** write `wrangler.toml` with
    `assets` binding + Rate Limiting binding; verify `yahoo-finance2`
    runs in the Workers runtime; confirm `caches.default` is being
    populated and read by hitting `/api/history-multi` twice from the same PoP
    and observing the second request skip the upstream call (log it);
    enable the scheduled live-provider smoke job.

## In scope for v1 (deltas from first draft)

- Canonicalize-then-validate at the route boundary (canonical form is
  the cache key, so the LRU and `caches.default` collapse variants)
- In-process LRU + per-IP throttle (dev-local; opportunistic on CF)
- Cloudflare Workers Rate Limiting binding wired up before public launch
  (requires Workers Static Assets target, not Pages — see Stack)
- Edge cache via `caches.default` (explicit Cache API, per-PoP, TTL only
  — no SWR; see Server route)
- Curated benchmark allowlist with per-benchmark adjustment policy
  (target + benchmark always fetched with the same `adjusted` value, so
  the comparison stays on a single return basis); canonical
  `InstrumentMeta` scope check
- Inner-join time alignment; summary metrics derived from aligned series
- Vitest unit tests for the deterministic logic
- **Provider contract suite + pinned fixtures for Yahoo** — first-class
  v1 work, since provider drift is the highest-risk silent failure mode
- Dark/light/system theme switching with no-flash inline-script bootstrap
- TradingView attribution on the public page

## Out of scope for v1

- Autocomplete on ticker input
- More than one comparison target at a time
- Non-US listings (different sessions / calendars)
- rVol or other comparable volume metric
- Persistence beyond theme preference (no DB, no saved comparisons)
- Auth
- E2E / chart visual tests

## Risks / followups

- **Yahoo unofficial drift.** `yahoo-finance2` keeps up with endpoint
  changes. Provider abstraction contains the blast radius.
- **`1D` granularity.** Yahoo 1m intraday only covers ~7 days back; fine
  for "today."
- **Benchmark adjustment semantics.** Default benchmark is `SPY` rather
  than `^GSPC` because Yahoo's `Adj Close` for `^GSPC` equals `Close`
  (the index has no dividends or splits to apply), while a US stock's
  `Adj Close` does fold in dividends/splits. Pairing adjusted target
  with `^GSPC` would systematically overstate stock outperformance over
  a year. SPY is dividend-bearing, so adjusted-on-both-sides is honest.
  Tradeoff: SPY has small tracking error vs the index (~ETF expense
  ratio + intra-distribution accumulation); for a personal comparison
  app this is acceptable. If we ever want a true price-only "S&P 500"
  benchmark, `^GSPC` is already in the allowlist with policy
  `price-only` (forces `adjusted=false` on both sides — also symmetric,
  just on the other return basis).
- **Cloudflare Workers (Static Assets).** `@sveltejs/adapter-cloudflare`
  builds for both Pages and Workers Static Assets; we target Workers
  because Pages Functions doesn't expose the Rate Limiting binding.
  Verify `yahoo-finance2` in the Workers runtime early.
- **Cache locality.** `caches.default` is per-data-center, so cache hit
  rate scales with traffic concentration per PoP. If we ever need
  globally-deduped upstream calls (e.g. Yahoo starts pushing back on
  fan-out), the path is to put the cacheable upstream call behind a
  real subrequest URL — Workers' normal HTTP fetch caching does honor
  edge-cache directives including SWR. That's a refactor, not a v1
  task.
- **Premium lane (your-own-key).** Deferred. Server route can read
  `FINNHUB_KEY` later; if set, `getProvider()` returns the paid provider.
  Provider interface already supports it.
- **CSP.** Not in v1. When added, the inline theme bootstrap script in
  `app.html` will need a SHA256 hash in `script-src` (see Theme
  handling). Plan for it before turning CSP on, otherwise either the
  theme flashes or the policy needs `'unsafe-inline'`.
- **Rate-limit tuning.** Workers Rate Limiting is per-CF-location and
  eventually consistent, and IP-based keys hit NAT/CGNAT users. Watch
  CF analytics for 429 spikes and concentrated IPs after launch; tune
  the limit (and consider a soft warning before a hard 429) from data.
