# Plan — Unified symbol entry & display

- **Date:** 2026-06-13
- **Status:** Implementation plan (decisions resolved 2026-06-13; ready to build)
- **Related:** [2026-06-10-cache-first-fetching.md](./2026-06-10-cache-first-fetching.md)

## Background

The toolbar currently exposes **two separate ways to add a series** and **two separate places that list the selection**:

1. **Add paths**
   - _Stocks_ — a free-text input (`+ ticker`, Enter to commit) with a debounced `/api/lookup`
     call that previews the resolved company name. Rendered as **colored, solid** lines.
     Capped at `MAX_STOCKS = 8`.
   - _Comparisons_ — the `CompareAddMenu` dropdown over a curated list of ~22 benchmarks
     (`src/lib/benchmarks.ts`), grouped US / Europe / Global / APAC. Rendered as
     **grayscale, dashed** lines. Capped at `MAX_COMPARES = 8`.

2. **Displays**
   - Header **chips** (one strip of stock chips + compare chips).
   - A second-row **stats cards** strip (per-symbol % change + colored dot).

The same symbols appear in both displays, and the two add paths impose a stock-vs-comparison
distinction that the product doesn't actually use — there is no cross-symbol computation that
needs the two buckets kept apart.

## Problem

- **Redundancy.** Chips and cards show the same selection twice; managing it (add/remove) and
  reading it (% change, color) are split across two UI regions.
- **Two mental models for one action.** "Add a stock" vs "add a comparison" forces the user to
  pre-classify a symbol before they can add it, and splits discovery (the curated index list is
  only reachable through the Compare dropdown).
- **Index discovery is buried.** The curated benchmark list — genuinely useful for discovery —
  is hidden behind a secondary dropdown instead of being part of the primary search.

## Goals

- **One entry field.** A single search box, positioned between the logo and the right-hand
  controls, adds any series — ticker or index.
- **One display.** A single managed list is both the legend (color + symbol + % change) and the
  control surface (add / remove). Chips and cards collapse into it.
- **Auto-classified kind.** The user never picks "stock" vs "comparison." The symbol's nature
  decides its visual treatment: a Yahoo **index → grayscale dashed**; **everything else → colored
  solid** (strict instrument-type rule — Decision 1).
- **Discovery-first search.** Focusing the empty field opens a **browse** panel of popular
  tickers and the curated indices; typing narrows to an **autocomplete** of matchable symbols.
- **No regression** in sharing/persistence, limits, or the return-basis correctness the docs
  page describes.

## Non-goals

- Cross-symbol math (spreads, ratios, correlations between series). The single-list model assumes
  none, which is why merging the buckets is safe.
- Reworking chart **rendering** (line styles, volume histogram). **In scope, though** — and
  originally mis-listed here — is the alignment + normalization-**baseline** change needed for
  mixed trading calendars (Phase 1.5): the inner-join becomes union + forward-fill, all series
  rebased to one **common baseline**. Review #1 (Finding 4) pulled alignment into scope; review #2
  (Finding 3) corrected the baseline semantics.
- Changing the data **provider**. The history endpoints' _shape_ does change — `history-multi`
  gains `symbols`/`basis` params and the dead legacy `/api/history` is removed (review #2,
  Finding 5). The docs that reference it (README, PLAN, cache-first plan) are updated in Phase 7.

## Proposed model

A selection becomes **one ordered list of symbols**, each with a derived `kind`
(`index` → gray/dashed, everything else → colored/solid). Color assignment follows list order
within each kind, reusing the existing `STOCK_PALETTE_SLOTS` / `COMPARE_PALETTE_SLOTS` and
`colorForSeries(kind, indexInKind)`. The first-added equity remains the volume anchor.

**Consequence of the resolved decisions — the "benchmark" bucket is retired.** With strict
classification (Decision 1) the only thing that makes a series gray/dashed is Yahoo reporting it
as `INDEX`; with the explicit return-basis toggle (Decision 2) the return basis no longer depends
on which symbols are "benchmarks." So the curated `BENCHMARKS` table stops being a behavioral
category and survives only as:

- a **discovery/browse seed** for the empty-field panel (R2),
- a **label/currency source** so indices show friendly names (e.g. "S&P 500 (^GSPC)"), and
- an **instrument-type source** via the explicit `asset` field (review #3, Finding 3) — used by
  fixtures and provisional kind, replacing the old `policy`-as-proxy hack.

The grayscale palette (`COMPARE_PALETTE_SLOTS`) is now used for _true indices only_; curated ETF
proxies like SPY/QQQ become ordinary colored series.

## Requirements

### R1 — Unified entry field

- **R1.1** A single search box sits in the header between the logo (left) and the controls
  (Save / Share / ⋯, right). On narrow widths it behaves responsively (it may take the full
  second row, consistent with the current responsive header).
- **R1.2** Committing a result (Enter on the highlighted item, or click) adds it to the selection
  and clears the box for the next entry.
- **R1.3** Adding a symbol already in the selection is a no-op (optionally flashes / scrolls to
  the existing item rather than erroring).
- **R1.4** The field replaces **both** the current ticker input and the Compare dropdown.

### R2 — Browse on focus (empty state)

- **R2.1** Focusing the empty field opens a dropdown showing a curated browse list:
  **popular tickers** + the **curated indices** (the existing `BENCHMARKS`, grouped by region).
- **R2.2** Browse items already in the selection are shown disabled/checked (parity with today's
  `CompareAddMenu` `isExcluded`).
- **R2.3** Index entries keep their rich labels (e.g. "S&P 500 ETF (SPY)") and currency, so the
  discovery value of the curated list is preserved.

### R3 — Autocomplete (typing)

- **R3.1** Typing ≥ N characters (proposed **N = 2**) queries for matching symbols and shows a
  ranked list. **Local and remote search share the same N-char threshold** — a single letter would
  surface a few bundled hits and then lurch as the larger remote set arrives, so neither fires
  below N; sub-threshold, only the exact-symbol action (R3.5) is offered. The browse panel (R2) is
  the empty-field state, not a sub-threshold filter.
- **R3.2** Network queries are **debounced** (proposed **~250 ms**) and **not** fired per
  keystroke; in-flight results are sequence-guarded (the existing `lookupSeq` pattern) so a slow
  response can't overwrite a newer query.
- **R3.3** Each result shows symbol, name, and a type hint so the user can disambiguate before
  adding. The hint uses the **finer asset class** ("Index", "ETF", "Equity") and, when available,
  the **exchange** — kept distinct from the coarse visual `kind` (`equity`/`index`) that drives
  color (Finding 7, review #2). So a result carries both `asset: 'EQUITY'|'ETF'|'INDEX'` (display)
  and a derived `kind` (color), plus optional `exchange`.
- **R3.4** Empty / error / loading states are explicit (parity with today's lookup states).
- **R3.5** A freely-typed symbol that resolves but isn't in any curated list is still addable.

### R4 — Classification & color (Decision 1: strict)

- **R4.1** A symbol's `kind` is derived, not chosen, and **strictly by instrument type**: Yahoo
  `INDEX` → grayscale dashed; everything else (equity, ETF, …) → colored solid. The curated
  benchmark set does **not** influence color — ETF proxies (SPY, QQQ, URTH) render colored/solid
  like any ticker.
- **R4.2** Source of truth is the Yahoo instrument type. `mapInstrumentMeta` already yields
  `INDEX`/`ETF`/`EQUITY` from the history meta; the search/autocomplete result type (R3.3) gives
  the same signal pre-add so the chip can render with the right treatment immediately.
- **R4.3** Color is assigned by position within the kind, mod the palette length (unchanged from
  `colorForSeries`). Grayscale palette is now reached only by true indices.

### R4b — Return-basis toggle (Decision 2: explicit control)

- **R4b.1** Dividend adjustment is controlled by an **explicit user-facing toggle**
  (price-only ↔ total-return), independent of which symbols are selected. This replaces the
  current per-benchmark `policy`-driven behavior.
- **R4b.2** The toggle applies to daily-and-longer ranges only; intraday (1D/5D) stays price-only
  regardless, matching today's behavior. The toggle is disabled/ignored (with a hint) on intraday.
- **R4b.3** Default state: **total-return** (preserves today's default, which used SPY's
  total-return policy). Persisted + shareable alongside the selection (R7).
- **R4b.4** The control lives in a low-prominence spot (e.g. the ⋯ overflow menu) — it's a
  refinement, not a primary action.
- **R4b.5** The docs page's "Return basis can be mixed" section must be rewritten: basis is now
  uniform across all series and user-chosen, not inferred per-benchmark.

### R5 — Unified display (chips + cards → one list) (Decision 3: cards become the list)

- **R5.1** A single component renders each selected symbol with: color dot/swatch, symbol,
  **% change** for the active range, and a **remove (✕)** control. Resolved name is secondary
  (tooltip / on hover) to keep the row compact. Layout matches the approved mock:
  `● AAPL +2.4% ✕   ● MSFT +1.1% ✕   ◐ SPY +0.8% ✕`.
- **R5.2** This list **is** the chart legend **and** the management surface. The standalone chips
  strip and the separate stats cards row are both removed; the header keeps only logo + search +
  controls, with this list on the row below.
- **R5.3** Horizontal-scroll + hidden-scrollbar behavior (the existing `no-scrollbar` utility) is
  preserved when the list overflows.
- **R5.4** Invariant relaxes from "≥ 1 stock" to **"≥ 1 series"** (the buckets are merged).
  Removing the last series is blocked. **Volume anchor:** the histogram tracks the **first equity**
  in list order, falling back to `symbols[0]` if no equity is selected; if the anchor is an index
  with no volume, the histogram is simply empty. Resolved — see Minor point B / Phase 1 (Finding 6).

### R6 — Limits

- **R6.1** **Resolved:** a single combined cap **`MAX_SYMBOLS = 16`** replaces the separate
  `MAX_STOCKS`/`MAX_COMPARES` (8 + 8 = **16**) caps. **16, not 12 (Finding 1, review #4):** the
  Goals promise "no regression … in limits," and 12 would have cut total capacity from 16 → 12; 16
  preserves it exactly **and** keeps the cache-first plan's memory sizing valid (it sizes the LRU to
  the `16 symbols × 5 intervals = 80`-key worst case — see [cache plan](./2026-06-10-cache-first-fetching.md):122). Declared once in
  `selection.ts`, enforced at parse (clamp), UI-add, and endpoint; the UI surfaces a clear "max
  reached" state. _Minor consequence:_ a single list now allows up to 16 **equities**, beyond the
  14-slot equity palette, so the 15th/16th equity repeats a color (disambiguated by symbol label) —
  a new but acceptable extreme that was impossible under the old 8-equity cap.

### R7 — Persistence & sharing

> No back-compat required — the app has no users yet, so we replace the stored/shared shape
> outright rather than migrating the legacy `{ stocks, compares }` form.

- **R7.1** The stored/shared model becomes a single ordered `symbols` list (kind is derived, not
  stored), plus the return-basis flag and `range`. Legacy `stocks`/`compares` parsing is removed.
- **R7.2** The return-basis toggle (R4b) is persisted and encoded in the share URL. The
  URL/storage token is the short form **`?basis=total|price`**, mapped to the internal
  `total-return|price-only` by a **single shared parser/serializer** (`parseBasis`/`serializeBasis`
  in `selection.ts`) so the wire token and internal value never drift (Finding 8, review #2).
  Absent → default `total-return`; a malformed token degrades to the default on the client, but the
  **endpoint rejects an explicitly-invalid `basis` with `400`**.

## Autocomplete data sourcing — analysis

> Direct answer to "what's a good way to get autocomplete data without hitting Yahoo on every
> keystroke, and how do I show all matchable tickers from a 2–3 char prefix?"

**Key existing asset:** `/api/lookup` already calls Yahoo's public search endpoint
(`https://query1.finance.yahoo.com/v1/finance/search?q=…&quotesCount=6`). That endpoint **is** a
prefix/fuzzy search that returns a _ranked list_ of matching symbols with names, types, and
exchanges — it works on the Workers runtime without a crumb/cookie, and we already wrap it in
throttle + LRU + edge-cache. Today we discard all but one match; autocomplete just needs the
whole `quotes[]` list.

**Option A — Debounced Yahoo search proxy (extend the existing endpoint).**
Add `/api/search?q=…` (or extend `/api/lookup`) that returns the ranked `quotes[]`. Client
debounces ~250 ms, min 2 chars, sequence-guards responses. Cache per-query at the edge + LRU
(short s-maxage, e.g. a few minutes, since prefixes repeat heavily across users).
_Pros:_ reuses working infra; broad Yahoo coverage; minimal new code.
_Cons:_ each distinct prefix is a network round-trip (mitigated by debounce + cache); subject to
Yahoo rate limits on the egress IP (already an issue in local dev — see the static-data plan;
fixture mode must short-circuit this too). _Coverage caveat:_ "searchable" is not "always
chartable" — results must be **filtered to addable types** (equity/etf/index). Mixed-calendar
charting is fully handled once the union + forward-fill alignment lands (Phase 1.5), so foreign
picks no longer empty or clip the chart.

**Option B — Bundled local symbol index.**
Ship a static dataset (e.g. S&P 500 + major listings + the curated indices) and prefix-filter
client-side. _Pros:_ instant, zero network, no rate limits. _Cons:_ coverage limited to the
bundle; bundle size/freshness upkeep; misses the long tail and foreign symbols.

**Option C — Hybrid (CHOSEN — Decision 4).**
Local-first for instant feedback + Yahoo for the long tail:

1. The curated indices (`BENCHMARKS`) and a small popular-ticker seed list are **bundled** and
   filtered client-side — instant, and they power the browse-on-focus state (R2) for free.
2. For the long tail, the debounced Yahoo proxy (Option A) augments the local matches; results
   are merged + deduped (local entries win on label quality).
3. Fixture/static mode resolves purely from the local set (never touches Yahoo), consistent with
   `npm run dev:static`.

_Why C:_ it makes the common cases (indices, mega-cap tickers) feel instant and offline-safe,
keeps the curated discovery experience, and still resolves anything Yahoo can — at the cost of a
modest bundled list to maintain. Option A alone is a perfectly good MVP if we want to defer the
bundle; B alone is rejected (coverage gap defeats "show all matchable tickers").

## Decisions resolved (2026-06-13)

1. **Classification — strict by instrument type.** Only Yahoo `INDEX` is gray/dashed; ETF proxies
   (SPY, QQQ, URTH) render colored/solid like any ticker. → R4.
2. **Return basis — explicit toggle.** A user-facing price-only ↔ total-return switch replaces the
   per-benchmark policy logic. → R4b.
3. **Display — cards become the list.** The %-change cards are the legend + management surface;
   chips are removed. → R5.
4. **Autocomplete — hybrid.** Bundled curated indices + popular tickers for instant matches;
   debounced Yahoo proxy for the long tail. → sourcing analysis, Option C.

Together, (1) + (2) **retire the "benchmark" bucket** as a behavioral category — see the
_Consequence_ note under Proposed model.

## Minor points — now resolved in the implementation plan

- **A. Combined limit (R6).** Resolved: a single **`MAX_SYMBOLS = 16`** (= the old 8 + 8 total, so
  no capacity regression — Finding 1, review #4), exported once and enforced at parse/UI/endpoint
  (Finding 7, review #1).
- **B. Volume anchor (R5.4).** Resolved: anchor = first **equity**, else `symbols[0]`; ship the
  anchor's **own** raw bars (not the intersection), per PLAN.md (Finding 6).
- **C. Foreign symbols / mixed calendars (Finding 4).** Resolved: **union + forward-fill (LOCF)**
  replaces the inner-join (Phase 1.5). No empty/clipped charts; identical output for single-
  calendar sets.

## Out of scope / follow-ups

- Any cross-series analytics that would re-introduce a stock/benchmark distinction.
- Server-side popularity ranking for the browse list (the seed list can start hand-curated).
- Maintaining/refreshing a large bundled symbol index (only relevant if Option C grows beyond a
  small seed).

---

# Implementation plan

Grounded in the current code (file:line references are from `main` @ this branch). The natural
seam: **data model → server → search box → unified display → basis toggle → colors → analytics →
cleanup/docs/tests.**

> **One big-bang swap, green at its ends — not at every internal boundary (Finding 2, review #2).**
> Review #1 pushed for "green at every phase boundary," but that's not actually reachable here: the
> type changes (`StoredSelection`'s shape, the `SeriesKind` rename, the `basis` thread) and **all**
> their consumers — `selection.ts`, `+page.svelte`, `AccountMenu.svelte`, `chart/setup.ts`
> (`lineOptions` switches on the renamed kind), `history-multi` — must move together, and
> `+page.svelte` can't be partially migrated without its full UI rework. Pretending otherwise (e.g.
> "rename the kind in Phase 0, restyle it in Phase 5") would leave a stale `switch` that won't
> typecheck. **So the honest contract:** Phases **0–5 are a single model swap**; `npm run check` /
> `npm test` are green **before** Phase 0 and green again **at the end of Phase 5**, but
> intermediate boundaries inside the swap are _not_ individually green. Phases **6–7 are additive
> and individually green.** Each phase still lists its consumer + test fallout so the end-state is
> reachable, and `AccountMenu`'s shape migration is pulled **into the swap (Phase 3)** rather than
> stranded in Phase 7 after the gate.

## Revisions after review (2026-06-13)

This plan was revised against a 10-point review. Two of the review's catches reversed earlier
choices of mine, and the rest are folded into the phases below (see _Review responses_ at the
end for the full map):

- **~~Keep `BENCHMARKS.policy`~~ → Replace it with an explicit `asset` field and remove it**
  (revised again by review #3, Finding 3). Review #2 said keep `policy` because `fixtures.ts:75`
  used it as an INDEX/ETF proxy — but inferring instrument type from a _return-basis_ field is the
  exact coupling R4 retires. The fix is an explicit `asset: 'INDEX'|'ETF'` on `BenchmarkEntry`;
  once fixtures read that and the basis helpers are gone, `policy` has no consumers and is deleted.
- **Keep `/api/lookup`** — needed for exact single-symbol resolution (incl. 1-char tickers like
  `F`) and for restoring names on cold shared-link loads. (Earlier draft wrongly deleted it.)
- **Delete the legacy `/api/history` + `validate.ts`** instead — they have _no client callers_
  (only `validate.ts` self-references the path string) and are the real owners of the
  benchmark-policy coupling.

## Current-state anchors

- **Two add paths & two displays** in `src/routes/+page.svelte`: stock chips + ticker input
  (`:587–664`), compare chips + `CompareAddMenu` (`:666–706`), stats-cards (`:768–812`); header
  actions (Save/Share/⋯) `:709–765`.
- **Kind is already known from Yahoo.** `mapInstrumentMeta` (`providers/yahoo.ts:102`) yields
  `asset: 'EQUITY'|'ETF'|'INDEX'|'OTHER'`; `isTargetInScope` (`server/scope.ts:3`) accepts the
  first three. So **the server stamps each series' kind** (`INDEX → index`, else `equity`) — the
  client never has to guess for the chart, only for the brief pre-fetch render.
- **Return basis is benchmark-driven today:** `history-multi` `buildRequest`/`pickReturnBasis`
  (`:85–108`) and the legacy route's `adjustedFor`/`effectiveReturnBasis` (`benchmarks.ts`).
- **Selection shape** `{ stocks, compares, range }` spans `selection.ts`, `+page.svelte`,
  `AccountMenu.svelte:10/17/42/276`, and `selection.test.ts`.
- **Search groundwork:** `/api/lookup` calls Yahoo `v1/finance/search` (`quotesCount=6`) and
  keeps one match (`:118–146`); short-circuits in fixture mode (`:50–57`). **But** it caches
  _any_ upstream failure as `notfound` for 24 h (`:127–130`) — a latent poisoning bug to fix, not
  to clone.
- **Volume divergence (PLAN.md):** PLAN.md §"Normalization & alignment" (lines 298–306, 460–461)
  requires the volume sub-pane to use the **anchor's own timestamps, not the cross-series
  intersection** ("tying it to the intersection would silently zero a real volume bar"). The
  legacy route honors this (`history/+server.ts:166`, raw bars); **`history-multi` regressed it**
  to `alignVolume(primary.bars, commonTimes)` (`:289–292`). We fix it here.
- **Edge rate limit key is a bare IP** (`checkEdgeRateLimit(platform, tKey)`), so a new endpoint
  shares the chart's budget. (In-process throttles are already per-endpoint instances.)
- **Tests exist** (`vitest`; `npm test`, `npm run build`): `selection`, `validate`, `benchmarks`,
  `normalize`, `summary`, `cache`, `throttle`, `cross-session`, `providers/*`. Several cover code
  we're changing — they move with their phase.
- **Dead/replaced:** `BenchmarkSelect.svelte` — **zero references** (delete); `CompareAddMenu` —
  replaced (delete).

## Shared constant

`MAX_SYMBOLS` (**16** = the old 8 + 8 total, resolving Open point A; Finding 1, review #4) is declared **once** in `selection.ts`
and imported by the page, `history-multi`, and `parseSelection`/`parseSelectionParams` — so the
cap is enforced identically at **parse, UI-add, and endpoint** (Finding 7: today a crafted URL or
oversized stored blob would load then 400). Parse **clamps** (keeps the first `MAX_SYMBOLS`)
rather than rejecting, so a long link degrades gracefully.

## Shared validator (Finding 1, review #2 — critical)

The current `SYMBOL_RE = /^[A-Z\^.\-]{1,8}$/` is **letter-only and capped at 8 chars**. Today the
curated indices with digits or 9+ chars — `^N225`, `^KS11`, `^STOXX50E`, `000001.SS`,
`000300.SS` — never hit it, because the _compares_ path validates them by `isBenchmarkSymbol`
membership instead. The moment everything routes through one unified field, that regex would
**silently reject five curated entries** (and any legitimate digit-bearing Yahoo symbol, e.g.
`BRK-B`'s sibling tickers, `005930.KS`).

**Resolved:** a single `isValidSymbol(s)` declared **once** (in `selection.ts`, imported by
`selection`, `history-multi`, `api/search`, `api/lookup`) that accepts a symbol if **either**:

1. it is a `BENCHMARKS` key (`isBenchmarkSymbol` — guarantees every curated entry round-trips), or
2. it matches a broadened regex `^[A-Z0-9.^=-]{1,14}$` (digits allowed, length 14 for headroom).

The four per-file copies of `SYMBOL_RE` (`selection.ts:14`, `lookup/+server.ts:9`, and the new
`history-multi`/`search` validations) collapse into this one import. **Test:** round-trip **every**
`BENCHMARKS` key through `normalizeSymbol` → `parseSelection`/`parseSelectionParams` → the
`history-multi` symbol validation, asserting none are dropped (plus a few representative Yahoo
symbols with digits/dots/hyphens).

## Phase 0 — Shared model & types (atomic with consumers + tests)

1. **`chart/setup.ts` + `providers/types.ts`** — rename `SeriesKind` `'stock'|'comparison'` →
   **`'equity'|'index'`** (touch `chart/setup.ts:17`, `+page.svelte:34`, `history-multi:33`); this
   forces `chart/setup.ts:153–165` `lineOptions` to switch on the new kinds **in the same move**
   (Finding 2). Add `ReturnBasis = 'price-only'|'total-return'` (the user choice; the meta's
   `'mixed'` is removed). Add a shared **`SymbolSearchResult = { symbol; name; asset:
'EQUITY'|'ETF'|'INDEX'; kind: 'equity'|'index'; exchange?; currency? }`** (Finding 7): `asset` is
   the fine class shown as the R3.3 hint, `kind` is the derived color treatment (`INDEX → index`,
   else `equity`), `exchange` is the optional disambiguator. Used by `/api/search`, `searchLocal`,
   and `onAdd`.
2. **`selection.ts`** — `StoredSelection` → `{ symbols: string[]; basis: ReturnBasis; range }`.
   Rewrite parse/serialize/params (`?symbols=…&basis=…&range=…`); **delete** the legacy
   single-pair branch (`:77–83`) and `LEGACY_SELECTION_STORAGE_KEY` (`:5`, `:103–116`). Export
   `MAX_SYMBOLS` and the shared **`isValidSymbol`/`normalizeSymbol`** (Finding 1 — broadened to
   accept digit-bearing / 9+-char curated symbols and `BENCHMARKS` keys; replaces the old letter-only
   `SYMBOL_RE`). **Parse order is fixed (Finding 5, review #3):** `parseSelection`/
   `parseSelectionParams` **normalize** (trim + uppercase) → **drop invalid** (`isValidSymbol`) →
   **dedupe preserving first occurrence** → **then clamp to `MAX_SYMBOLS`** → enforce `≥1`. Dedupe
   must precede clamp so case/whitespace duplicates (`aapl`, `AAPL`) don't consume the cap or
   trigger redundant fetches. Add the shared **`parseBasis`/`serializeBasis`** (Finding 8):
   URL/storage token `total|price` ↔ internal `total-return|price-only`; absent or malformed →
   default `total-return` (the _endpoint_ is stricter — it 400s on a malformed token, step 7).
3. **`benchmarks.ts`** — `BENCHMARKS` becomes a **label/discovery + fixtures-metadata source**.
   **Add an explicit `asset: 'INDEX'|'ETF'` to `BenchmarkEntry` (Finding 3, review #3)** and
   populate it for all entries (this is the real instrument type — `^GSPC`→`INDEX`, `SPY`→`ETF` —
   not something to infer). **Remove `policy`:** with the basis helpers gone (below) and fixtures
   repointed to `asset` (step 3a / fixtures edit), `policy` has **zero consumers** — so it's deleted,
   not kept. (This reverses review #2's "keep policy"; `asset` is the proper decoupling its Finding 1
   was reaching for.) **Keep** `isBenchmarkSymbol`, `groupedBenchmarks`, `BENCHMARK_GROUP_*`,
   `intervalForRange`, `periodForRange`, `isIntradayRange`, `DEFAULT_RANGE`. **Remove**
   `DEFAULT_BENCHMARK`, `effectiveReturnBasis`, `adjustedFor`, `AdjustmentPolicy` (their only
   consumers are the legacy route + `validate.ts`, deleted in step 5). Add
   `DEFAULT_SYMBOLS = ['AAPL', 'SPY']`, `DEFAULT_BASIS = 'total-return'`.
   - **3a. `providers/fixtures.ts`** — repoint `metaFor` (`:75`) from
     `b.policy === 'price-only' ? 'INDEX' : 'ETF'` to **`b.asset`** directly (Finding 3). Same move
     atomically since `policy` is removed.
4. **`symbols.ts` (new)** — bundled local index (Decision 4 hybrid): `POPULAR_TICKERS` seed
   (AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA, BRK-B, JPM, V, …, each with `asset:'EQUITY'`);
   `buildBrowseList()` (Popular group + `groupedBenchmarks()` indices, the latter reading the
   `BENCHMARKS` **`asset`** field directly — Finding 3, not inferred from `policy`/label);
   `searchLocal(q): SymbolSearchResult[]` emitting the full `{ asset, kind, currency }` shape
   (Finding 7), with `kind` derived from `asset` (`INDEX → index`, else `equity`).
5. **Delete legacy route + validator + its test** (atomic with step 3): remove
   `routes/api/history/+server.ts`, `lib/server/validate.ts`, `tests/validate.test.ts`.
6. **Update tests now**: rewrite `selection.test.ts` for the new shape + clamp/`≥1` rules; trim
   `benchmarks.test.ts` of the removed helpers (keep interval/period/grouping coverage).

## Phase 1 — Server

7. **`history-multi/+server.ts`** —
   - One ordered **`symbols`** param (drop `stocks`/`compares`) + a **`basis`** param; validate
     each symbol with the shared **`isValidSymbol`** (Finding 1, not a local letter-only regex);
     enforce the shared **`MAX_SYMBOLS`**. Parse `basis` via the shared **`parseBasis`**, but here
     reject an **explicitly-invalid** token with **`400`** (Finding 8) rather than silently
     defaulting — a bad client param should surface, not mask.
   - `adjusted = !isIntradayRange(range) && basis === 'total-return'` for **all** symbols. Delete
     `pickReturnBasis` (`:85–95`) and the benchmark branch of `buildRequest` (`:97–108`).
   - **Stamp kind + asset from meta**: `kind = result.meta.asset === 'INDEX' ? 'index' : 'equity'`,
     and **emit `asset` (`'EQUITY'|'ETF'|'INDEX'`) on each response series** too (Finding 4,
     review #4) — it's already computed, and the client's `symbolMeta` needs it (the response
     otherwise carries only `kind`+`currency`). Apply `isTargetInScope` to **every** symbol (reject
     `OTHER` → 400), not just stocks (`:256`).
   - **Anchor — one server-chosen series for volume _and_ timezone (Findings 6 & 4):** compute the
     anchor **once** = first `equity` symbol, else `symbols[0]`. Today `primarySymbol = stocks[0]`
     drives **both** `primaryVolume` (`:289–292`) and `meta.timezone` (`:300` `primary.timezone`);
     keep them coupled to the _new_ anchor so volume bars and the tooltip's time axis can't reference
     different series. Ship the anchor's **own raw bars** (`anchor.bars.map(...)`), **not**
     intersected to `commonTimes` (fixes the regression at `:289–292`; shared time scale renders gap
     bars fine), and set `primaryVolume.symbol` + `meta.timezone` from that same anchor.
   - `meta.returnBasis` = effective basis (intraday always `'price-only'`); **no `'mixed'`**.
     Include `basis` in the LRU + edge cache key (`:182–189`) so the two bases don't collide.
8. **`server/ratelimit.ts` usage (Finding 9)** — pass **endpoint-scoped keys** to
   `checkEdgeRateLimit`: `history:<ip>`, `search:<ip>`, `lookup:<ip>` (one-line change at each
   call site) so autocomplete bursts don't consume the chart budget.
9. **`api/search/+server.ts` (new)** — Yahoo `v1/finance/search` list endpoint, reusing the
   throttle/LRU/edge-cache pattern but **not** lookup's failure handling:
   - Returns `SymbolSearchResult[]`, **filtered to supported types** — map Yahoo `quoteType`
     `EQUITY → asset:'EQUITY'`, `ETF → asset:'ETF'`, `INDEX → asset:'INDEX'`, deriving
     `kind = asset === 'INDEX' ? 'index' : 'equity'` and carrying Yahoo's `exchange`/`exchDisp`
     (Finding 7); **drop** MUTUALFUND/CURRENCY/FUTURE/CRYPTO etc. so every result is addable
     (Finding 3). `q` length `≥ 2` (the _list_ threshold only).
   - **Failure contract (Finding 8):** cache **only** successes and genuine empty results; on
     upstream `429`/`5xx`/network error return a distinct status (502/empty-uncached) and **do
     not** write a `notfound` cache entry. Apply the same fix to `/api/lookup`.
   - **Fixture mode:** return `searchLocal(q)` **plus a synthetic exact match** for `q` itself, so
     `dev:static` keeps README's "any symbol" promise (Finding 3), zero network.
   - Short `s-maxage` (prefixes repeat across users).
10. **`api/lookup/+server.ts` — keep & harden**: resolves a symbol → name/asset for Enter-to-add
    and cold-load names; handles **1-char** symbols (no min length), validated by the shared
    `isValidSymbol` (Finding 1). **Exact-equality only (Finding 4):** today it falls back to the
    top-ranked result when no exact match exists (`:133–134` `?? quotes[0]`) — drop that fallback so
    a non-existent symbol returns **404** instead of silently adding Yahoo's best guess (the
    Enter-to-add path in Phase 2 depends on `lookup` returning _the symbol the user typed_, not a
    near-miss). Also **filter the exact match to supported `quoteType`** EQUITY/ETF/INDEX — an exact
    hit that's crypto/futures/FX is rejected as 404, not added. Returns `asset`/`kind` like
    `/api/search`. Apply the same don't-cache-transient-failures fix (Finding 8); switch to the
    `lookup:<ip>` rate key.

## Phase 1.5 — Union + forward-fill alignment, common baseline (Findings 4 & 3, resolved)

Replaces the inner-join so mixed calendars/sessions never empty or clip the chart — **while keeping
the apples-to-apples common baseline** a comparison chart needs (Finding 3, review #2). The first
draft rebased each series to its _own_ first close, which would compare two markets over different
windows; PLAN.md (`:453`) requires a shared baseline, and so do we.

**The baseline rule.** Define `baseTime` = the **first union timestamp at which every non-empty
series has a value** (real or forward-filled). Concretely that's `max` over the non-empty series of
each series' first-real-bar timestamp: at that instant the latest-joining series has its real first
bar, and every earlier series — having started before it — has a real-or-LOCF value too, so a common
baseline **always exists** (no empties) as long as ≥1 series is non-empty. Every series is rebased to
its close **at `baseTime`**, so all lines pass through 0% there. **Where output equals today
(Finding 6, review #4):** the byte-identical-to-inner-join guarantee holds only when **every symbol
has the _identical_ set of timestamps** — then the union equals the intersection, fill never fires,
and `baseTime` = the window start. That's the common all-US case, but it is **not** guaranteed by
"single calendar" alone: an IPO mid-window, a trading halt, or a provider-missing bar gives two
same-market symbols _different_ timestamp sets, so the union exceeds the intersection and LOCF fills
the gap. That divergence is the **intended improvement** — today's inner-join silently _drops_ those
timestamps from every series; union+LOCF keeps them and carries the sparse series forward.

A. **`chart/normalize.ts` (new helper + test)** — add `unionForwardFill(barsBySymbol: Map<string,
   Bar[]>): { times: number[]; baseTime: number; aligned: Map<string, ClosePoint[]> }`:

- `times` = sorted union of all in-window bar timestamps.
- Per symbol, walk `times` carrying `lastClose`: a real bar → use & update it; a missing
  timestamp **after** the first real bar → carry `lastClose` (LOCF); **before** the first real
  bar → omit (leading whitespace).
- `baseTime` = `max` of each series' first-real-bar timestamp (the common-baseline instant).
- Output each series as a dense `ClosePoint[]` from its first real bar onward. A longer series
  keeps its pre-`baseTime` points (they render to the left, rebased to `baseTime` so the series
  reads relative to the common start) — strictly more information than the inner-join, which
  dropped them.
  B. **`history-multi/+server.ts`** — replace `intersectionTimes` + `alignBars` (`:110–137`,
  `:262–273`) with `unionForwardFill`. **Delete the "no overlapping bars" 502** (`:267–269`).
  New empties rule: a symbol with zero in-window bars returns an empty `aligned` (its line is
  absent) — only 502 if **every** symbol is empty. **`summary.pctChange` is computed from each
  series' close at `baseTime` to its last _real_ close — the same span the chart renders
  (Finding 1, review #3)** — _not_ from the series' own first bar; otherwise the number beside the
  chart would disagree with the line for staggered histories, which PLAN.md:490 forbids ("the
  number next to the chart never disagrees with the chart itself"). The `baseTime` close is the
  per-series denominator `windowedPctChange` already needs; just feed it `baseTime` instead of
  `aligned[0]`. **An empty/absent series has _no_ change, not `0%` (Finding 5, review #4):** for a
  series with no real bars, `summary.pctChange` is **`null`/omitted** (the type becomes
  `pctChange?: number`) — never `0`. This requires reworking `windowedPctChange` (`normalize.ts:29`,
  which today returns `0` for `<2` points) to return `number | undefined`; an absent value renders
  as "—" in the list (Phase 3), so we don't falsely claim "unchanged." Emit `meta.baseTime` and
  `meta.windowStart/End` = union span.
  C. **Client** — `pctChangeSeries` (`normalize.ts:22`) currently rebases to `points[0]` (each
  series' own first close); change it to rebase every series to **its close at `meta.baseTime`**
  (a `baseClose`/`baseTime` arg) so all series share the baseline (Finding 3). Series may still
  start at different x (cross-market intraday); the tooltip already renders "—" before a series
  starts (`+page.svelte:953`). Optionally emit leading whitespace markers for cleaner starts
  (polish).

> Volume is untouched — already the anchor's own bars (Finding 6). Caching is untouched — the key
> already covers `(symbols, range, basis)`; `baseTime` is derived from those, not an input.
> **Degenerate case:** two series whose data is fully disjoint in time (e.g. delisted vs newly
> listed, or intraday US vs Asia with no overlapping instants) still get a `baseTime` (the later
> series' start); the earlier series renders as an LOCF-flat segment from there on. A flat segment
> beats a blank chart — consistent with the LOCF philosophy below.

## Phase 2 — Unified search box (R1–R3)

11. **`ui/SymbolSearch.svelte` (new)** — on a bits-ui primitive (confirmed in 2.18.1:
    `command`/`combobox`/`select`); **`Command`** (cmdk-style, grouped) is the strongest fit,
    `Combobox` the fallback.
    - **Browse on focus** (R2): empty field → `buildBrowseList()`; already-selected items
      disabled (port `CompareAddMenu` `isExcluded`).
    - **Typeahead** (R3): `≥2` chars → instant `searchLocal(q)`, then merge debounced (~250 ms)
      `/api/search` (deduped by symbol, local label wins), sequence-guarded (reuse the `lookupSeq`
      pattern, `+page.svelte:92`,`:511–528`). Emit a `search_no_results` analytics event when both
      sources are empty.
    - **Dedicated exact-symbol action (Finding 2, review #3 — supersedes "Enter on no highlighted
      row"; ordering/shortcut pinned by Finding 7, review #4):** bits-ui `Command` **auto-highlights
      the first visible item**, so there is no "nothing highlighted" state — typing `F` could
      highlight local `^FTSE` and a bare Enter would add _that_, not resolve Ford. Instead, whenever
      the typed token is `isValidSymbol`, render an **explicit "Use exact symbol: `X`" item** as its
      own action, independent of auto-highlight. **Exact ordering & keys:**
      - **Below the `≥2` list threshold** (e.g. 1-char `F`, or zero matches): the exact item is the
        **only/primary** row, so it's auto-highlighted and plain **Enter** adds it.
      - **At `≥2` chars with matches:** the exact item is pinned in its **own group at the bottom**
        of the list, _below_ the ranked matches, so plain **Enter** still adds the highlighted best
        match (the common case). The exact item is reachable two ways: arrow-navigate to it, or the
        dedicated chord **⌘+Enter (macOS) / Ctrl+Enter (other)** which fires exact-add from anywhere
        in the field regardless of highlight.
        Selecting it calls `/api/lookup` with exact-equality (Finding 4, review #2 — a typo 404s, no
        near-miss substitution). This is how 1-char tickers **and long-tail symbols missing from
        Yahoo's top-6 search results** stay reachable (tested below).
    - Rows show symbol · name · type hint (R3.3). **`onAdd(result: SymbolSearchResult)`** passes
      the **full** result (Finding 2), not just the string; props `{ selected, disabled, onAdd }`.
12. **`+page.svelte`** — replace the chip strips + ticker input + `CompareAddMenu` (`:584–707`)
    with `<SymbolSearch>` between logo and actions. Delete `stockInput`/`lookupStatus`/`runLookup`
    /the lookup `$effect`/`addStock`/`onStockKeydown` (`:64–65`,`:89–93`,`:425–528`). Add
    `addSymbol(r: SymbolSearchResult)` (guard `MAX_SYMBOLS` + dupe) and a
    **`symbolMeta: Map<string, { kind; asset?; name? }>`** — a **partial** record (Finding 4,
    review #4): the history response carries `kind` + **`asset`** per series (asset is added to the
    response in Phase 1 step 7 — it's already computed to derive `kind`, so emitting it is free) but
    **not `name`**, so `name` is optional and filled lazily. Populate from each add
    (`SymbolSearchResult` has all three) and from `data.series` after load (`kind` + `asset`). On a
    **cold shared-link load** (symbols only), `kind`/`asset` are provisional-from-local then
    reconciled by the server's values.
    - **Tooltip/volume anchor (Finding 4, review #3):** repoint `getAnchorSymbol()` (`:421–423`,
      today `stocks[0]`) to **`data.primaryVolume.symbol`** — the server's authoritative anchor — so
      `subscribeTooltip`'s y-positioning (`setup.ts:265`,`:292–300`) sits on the _same_ series the
      volume bars and `meta.timezone` use. (Time formatting at `:940` already reads
      `data.meta.timezone`, which the server now sources from that anchor.)
    - **Name resolution — memoized, bounded, on-demand (Finding 7 review #3 + Finding 4 review #4):**
      chart render does **not** depend on names (it has symbols + server `kind`/`asset`), so do
      **not** fan out `/api/lookup` for all symbols on a cold link (a full 16-symbol share would
      otherwise fire 16 Yahoo calls). Extract a pure **`nameResolver`** helper: resolves a missing
      name only when a row needs it, **memoizes one request per symbol** (a resolved or failed symbol
      is never re-requested), **dedupes in-flight requests** (concurrent asks for the same symbol
      share one promise), and caps **≤2 concurrent** requests (the rest queue). Never blocks chart
      load; a row shows its symbol until its name arrives. Unit-tested for concurrency + dedup
      (below).

## Phase 3 — Unified display (R5)

13. **`ui/SeriesList.svelte` (new)** — merged legend + management surface (Decision 3); driven by
    selection order (renders before data), enriched by `data.series` summary + `symbolMeta`. Per
    item: swatch (● equity / ◐ index), symbol, `%change` once loaded, `✕`; `no-scrollbar`
    overflow (reuse `:769`); block removing the last symbol (≥1, R5.4). **Absent change renders
    "—", never `0%` (Finding 5, review #4):** when a series' `summary.pctChange` is `null`/omitted
    (an empty/absent series — e.g. a symbol with no in-window bars), show "—", not a green/red
    `0.0%`, so the list never falsely claims "unchanged." Props
    `{ symbols, kindFor, colorFor, summaryFor, onRemove }`.
14. **`+page.svelte`** — delete the stats-cards section (`:768–787`); render `<SeriesList>` below
    the header; keep the **range pills** (`:789–811`) on that row (list left, pills right).
    14b. **`ui/AccountMenu.svelte`** — migrate props/display to `{ symbols, basis, range }`
    (`:10/17/42/276`). Moved here from Phase 7 (review #2 Finding 2): it's a `StoredSelection`
    consumer, so it must land **inside** the model swap or the tree never reaches green at the end of
    Phase 5. **Safe-parse the stored `selection` (review #4 Finding 2):** today `loadList` casts DB
    rows verbatim (`:75 as SavedRow[]`) and `applySaved` passes the raw JSON straight to `onLoad`
    (`:100–101`) — so a row whose `selection` doesn't match the current shape becomes
    runtime-invalid. We're **not** grandfathering existing rows (no users yet — accepted break, R7),
    but route the read through the shared `parseSelection` validator anyway so a stale/garbage/old-
    shape row is **skipped or defaulted**, not crashed on. (No version/migration gate — the reviewer
    couldn't know there are zero saved rows; we do.)

## Phase 4 — Return-basis toggle (R4b)

15. **`ui/OverflowMenu.svelte`** — basis segmented control (price-only ↔ total-return), modeled
    on the Theme `RadioGroup` (`:96–169`); props `{ basis, onBasisChange, intraday }`; disabled +
    hinted when `intraday` (R4b.2). Fires `return_basis_changed`.
16. **`+page.svelte`** — `let basis = $state<ReturnBasis>('total-return')`; send in `load()`'s
    query (`:316–319`); include in persist/url/share/`AccountMenu` selection; pass
    `intraday = isIntradayRange(range)`.

## Phase 5 — Colors & kind reconciliation

17. **`chart/setup.ts`** — the `SeriesKind` rename and the `lineOptions` (`:153–165`) kind cases
    (`index → dashed/1.5px + gray`, `equity → solid/2px + colored`; palettes unchanged, gray reached
    only by indices) **already landed in Phase 0** with the type rename (Finding 2 — a renamed type
    can't leave a stale `switch`). Nothing further in `chart/setup.ts` here; this phase is the
    page-side reconciliation in step 18.
18. **`+page.svelte`** — rework `seriesColors` (`:103–113`): kind is authoritative from
    `data.series`/`symbolMeta` when present, else provisional (`index` if in the local index list,
    else `equity`); assign palette **by position within kind** over ordered `symbols`.
    `renderChart` (`:409–419`) already maps server `kind` → spec.

## Phase 6 — Analytics (Finding 10)

19. **`analytics/posthog.ts`** — add a thin `captureEvent(name, props?)` (no-op until inited).
    Wire minimal events, **never raw query text**: `symbol_added` `{ source: 'browse'|'search'|
'exact', asset }`, `symbol_removed`, `search_no_results`, `return_basis_changed` `{ basis }`.

## Phase 7 — Cleanup, docs

20. **Delete** `ui/BenchmarkSelect.svelte` (dead) + `ui/CompareAddMenu.svelte` (replaced).
    (`AccountMenu` migration moved to Phase 3 step 14b — Finding 2.)
21. **`docs/+page.svelte`** — rewrite "How to use it" (one search box; drop Compare/chips
    language); the basis is now **uniform + user-chosen**, so "Return basis can be mixed"
    (`:85–91`) becomes a description of the toggle; keep "Intraday is price-only" (`:92–95`).
    Rewrite "Trading-calendar gaps" (`:72–84`): bars are no longer dropped from every series —
    each series is carried forward (LOCF) across days/sessions it didn't trade, shown as a flat
    segment, all rebased to a common baseline (Phase 1.5).
22. **Prose docs that reference the deleted legacy route (Finding 5, review #2).** Deleting
    `/api/history` (Phase 0 step 5) leaves dangling references: **README.md:61**
    (`GET /api/history?symbol=…`), **PLAN.md:60/285/607**, and
    **2026-06-10-cache-first-fetching.md:117**. Update each to describe `/api/history-multi`'s new
    `?symbols=…&basis=…&range=…` shape (and drop the single-pair example), so the docs match the code
    after the deletion. No code callers exist (only `validate.ts` self-referenced the path, deleted
    in Phase 0).
23. **Reconcile the two linked plans comprehensively, not one line (Finding 3, review #4).** Both
    sibling plans assume the pre-unification world throughout; a single-line edit (item 22) leaves
    them internally contradictory. Add a **superseded-by banner** at the top of each, then fix the
    specific stale assumptions (or mark those sections superseded with a pointer to this plan):
    - **`2026-06-10-cache-first-fetching.md`** — assumes **both** history routes (`:117`), the
      `stocks + compares + range` cache key (`:17`), and a **16-symbol** worst case sized into the
      LRU (`:122,127,134,195,235`). The route/key facts change (one route, `symbols + basis + range`
      key); the **16-symbol × 5-interval = 80-key sizing stays valid** because `MAX_SYMBOLS = 16`
      (Finding 1) — call that out so the numbers aren't mistaken for stale.
    - **`2026-06-10-static-data-dev-toggle.md`** — references `policy` as the index/ETF signal
      (`:96,107–111`) and `intersectionTimes` (`:122`). Update to the explicit `asset` field
      (Finding 3, review #3) and union + forward-fill (Phase 1.5); note `policy` is removed.

## Testing (Finding 5)

Tests move **with the phase that changes their target** (not deferred to the end):

- **Phase 0:** rewrite `selection.test.ts` — URL/storage round-trips, `basis` default, **clamp to
  `MAX_SYMBOLS`**, `≥1`. **Validator round-trip (Finding 1):** every `BENCHMARKS` key survives
  `normalizeSymbol` → `parseSelection`/`parseSelectionParams` (catches the digit/9-char rejection),
  plus representative Yahoo symbols (`BRK-B`, `005930.KS`). **Dedup order (Finding 5, review #3):**
  case/whitespace duplicates (`aapl`, `AAPL`, `AAPL`) collapse to one, first occurrence wins, and
  dedupe happens **before** clamp (13 entries where two are dupes → 12 kept, not 11). **Basis codec
  (Finding 8):** `parseBasis`/`serializeBasis` round-trip `total↔total-return`, `price↔price-only`;
  absent and malformed → default. Trim `benchmarks.test.ts` (and **assert `asset` not `policy`** —
  every `^`-prefixed key is `asset:'INDEX'`, Finding 3). Delete `validate.test.ts`.
- **Phase 1:** route tests for `history-multi` — kind derivation from meta, `OTHER`→400 for every
  position, basis→`adjusted` mapping, intraday-forces-price-only, **malformed `basis`→400
  (Finding 8)**, **cache key separates by basis**, **volume anchoring uses anchor's own bars** (a
  sparse second series must NOT drop the anchor's volume bars), and **index-first/equity-second
  selection anchors volume _and_ `meta.timezone` on the equity (Finding 4, review #3)** — both come
  from the one server-chosen anchor, never different series. `api/search` tests — supported-type
  filtering, **`asset`/`kind`/`exchange` mapping from `quoteType` (Finding 7)**, `≥2` threshold,
  success/empty cached but `429`/`5xx` **not** cached, fixture-mode synthetic-exact + zero network.
  `api/lookup` (Finding 4, review #2) — 1-char resolution; **an inexact top-ranked result is rejected
  (404), not substituted**; **an unsupported exact hit (crypto/futures) is rejected (404)**; **a
  valid long-tail symbol absent from search's top-6 still resolves by exact lookup (Finding 7,
  review #4)**; transient failure does not poison the cache. **Empty-series contract (Finding 5,
  review #4):** a request mixing one symbol with in-window bars and one with **zero** in-window bars
  returns the empty one with `pctChange` **null/omitted (never `0`)** and an absent line, while the
  valid one renders normally (and is **not** dropped).
- **Phase 1.5:** `normalize.test.ts` — `unionForwardFill`: union of timestamps; LOCF after first
  bar; leading-edge omitted (no fill before first bar); **identical-timestamp-set input is unchanged
  (equals old inner-join) — Finding 6, review #4** (assert on equal timestamps, _not_ "single
  calendar"); a **sparse same-session pair** (two same-market symbols where one is missing an
  interior bar — IPO/halt/missing-bar) documents the intended result: the gap is **filled by LOCF**,
  not dropped (the explicit divergence from today's inner-join); a non-overlapping pair yields both
  series dense over the union (never empty). **Common baseline (Finding 3, review #2):** `baseTime` =
  max of first-real-bar times; **every series reads 0% at `baseTime`**; a longer series' pre-`baseTime`
  points are rebased to it (not to its own start); identical-timestamp `baseTime` = window start.
  **Summary == chart (Finding 1, review #3):** for a staggered-history pair, `summary.pctChange`
  equals the **final rendered chart value** of each series (close at `baseTime` → last real close),
  not the series' own first-bar-to-last span. **Nullable change (Finding 5, review #4):**
  `windowedPctChange` returns **`undefined`** (not `0`) for an empty / `<2`-point series.
- **Phase 2:** local+remote merge/dedup unit (extract a pure `mergeResults` helper to test
  without a DOM). **`nameResolver` (Finding 4, review #4):** N concurrent asks for the **same**
  symbol issue **one** request (in-flight dedup); a resolved/failed symbol is **never re-requested**
  (memoized); no more than **2** requests run concurrently (the rest queue).
- **Final:** `npm test` && `npm run check` && `npm run build`, plus a manual pass in `npm run dev`
  **and** `npm run dev:static`. **Manual checklist (Finding 6, review #3 — keep manual, no DOM
  component tests):**
  - **Search keyboard/interaction:** focus empty field → browse panel opens; ↑/↓ arrow navigation;
    Enter adds the highlighted match; **1-char/below-threshold** exact-add via plain Enter (e.g. `F`
    → Ford, not `^FTSE`); **≥2-char exact-add via ⌘/Ctrl+Enter** even while a ranked match is
    highlighted (Finding 7, review #4 — e.g. a long-tail ticker not in the top-6); Escape closes
    without adding; already-selected rows show disabled/checked.
  - **Empty series:** a symbol with no in-window bars shows **"—"** (not `0%`) and no line, while
    the others render (Finding 5, review #4).
  - **Limits & list:** adding at `MAX_SYMBOLS` shows the "max reached" state and blocks; removing
    down to the last series is blocked (≥1); list horizontal-overflow scrolls (hidden scrollbar).
  - **Responsive:** narrow width — search box reflows (full second row), series list + range pills
    stay usable.
  - **Zero-network:** `dev:static` — browse, typeahead, and exact-add all resolve locally.

## Files touched (summary)

> **Path convention (Finding 8, review #4).** All UI components live under the existing
> **`src/lib/components/ui/`** — the table uses full paths to make that explicit and avoid implying a
> new parallel `ui/` tree. Inline shorthand elsewhere in this doc (`ui/X.svelte`, `chart/`,
> `providers/`, `server/`, `analytics/`) maps to `src/lib/components/ui/`, `src/lib/chart/`,
> `src/lib/providers/`, `src/lib/server/`, `src/lib/analytics/`; routes are under `src/routes/`.

| Area         | New                                         | Edit                                                                                                                                                       | Delete                                         |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Model        | `src/lib/symbols.ts`                        | `src/lib/selection.ts`, `src/lib/benchmarks.ts`, `src/lib/providers/types.ts`, `src/lib/providers/fixtures.ts`, `src/lib/chart/setup.ts`                   | `src/lib/server/validate.ts`                   |
| Server       | `src/routes/api/search/+server.ts`          | `src/routes/api/history-multi/+server.ts`, `src/routes/api/lookup/+server.ts`, `src/lib/chart/normalize.ts`, `src/lib/server/ratelimit.ts` (call sites)    | `src/routes/api/history/+server.ts`            |
| Search UI    | `src/lib/components/ui/SymbolSearch.svelte` | `src/routes/+page.svelte`                                                                                                                                  | `src/lib/components/ui/CompareAddMenu.svelte`  |
| Display      | `src/lib/components/ui/SeriesList.svelte`   | `src/routes/+page.svelte`, `src/lib/components/ui/AccountMenu.svelte`                                                                                      | —                                              |
| Basis        | —                                           | `src/lib/components/ui/OverflowMenu.svelte`, `src/routes/+page.svelte`                                                                                     | —                                              |
| Analytics    | —                                           | `src/lib/analytics/posthog.ts`, `src/routes/+page.svelte`, `src/lib/components/ui/SymbolSearch.svelte`                                                     | —                                              |
| Cleanup/docs | —                                           | `src/routes/docs/+page.svelte`, `README.md`, `PLAN.md`, `docs/plans/2026-06-10-cache-first-fetching.md`, `docs/plans/2026-06-10-static-data-dev-toggle.md` | `src/lib/components/ui/BenchmarkSelect.svelte` |
| Tests        | —                                           | `selection.test.ts`, `benchmarks.test.ts`, (+ new `history-multi`/`search`/`lookup` tests)                                                                 | `validate.test.ts`                             |

## Decision (resolved) — foreign symbols & mixed calendars (Finding 4)

`history-multi` today inner-joins **all** series to one shared timestamp intersection
(`intersectionTimes`, `:110–126`; `alignBars`, `:128–137`) and 502s when it's empty (`:267`). A
foreign pick shrinks that set: on **intraday** (1D/5D) cross-market sessions may not overlap at
all (empty chart), and on daily+ a one-market holiday is dropped from _every_ series.

**Resolved: switch the inner-join to a union + forward-fill (LOCF), rebased to a common baseline.**
Build the union of all in-window timestamps; carry each series' last real close forward across
timestamps it's missing; leave the leading edge (before a series' first bar) empty. This eliminates
all three failure modes — no empty charts, no clipping, nothing dropped from the other series —
while keeping the data **dense** (full tooltips, connected lines). When **every symbol shares the
identical timestamp set** (the common all-US case) the union equals the intersection and fill never
fires, so output is **identical to today** — but note this is keyed on identical timestamps, not
merely "one calendar": IPOs, halts, or missing provider bars make two same-market series diverge,
and there union+LOCF intentionally keeps what the inner-join would have dropped (Finding 6,
review #4). It only diverges where today is lossy or broken. Implemented as **Phase 1.5**.

**Baseline correction (Finding 3, review #2).** Density is not enough — a comparison chart must put
every series on the _same_ baseline, or two markets get compared over different windows. So all
series are rebased to their close at **`baseTime`** = the first union timestamp where every
non-empty series has a value (= `max` of each series' first-real-bar time), guaranteeing all lines
read 0% there. When every symbol shares the **identical timestamp set** `baseTime` is the window
start, so the baseline matches today's inner-join exactly (Finding 6, review #4); PLAN.md's "aligned
series share a baseline" (`:453`) is preserved.

_Philosophical note:_ this reverses the current "only show days every series traded, never
synthesize" stance — LOCF shows a flat segment where a market was closed. That's the right call
for a comparison tool (a flat segment beats a blank chart), and the docs' "Trading-calendar gaps"
caveat is rewritten accordingly (Phase 7).

## Risks & mitigations

- **bits-ui primitive fit.** `Command`/`Combobox` confirmed present (2.18.1). If either fights the
  design, fall back to a custom `input` + `DropdownMenu`-style popover. Decide early in Phase 2.
- **Color flicker on add.** A freshly typed symbol's kind is provisional until the server
  responds. Mitigation: trust the local index list for indices; equities default to colored
  (correct for the vast majority); reconcile from `data.series` on load.
- **Search cache poisoning (Finding 8).** Mitigated by the success/empty-only caching contract;
  the same fix retro-applied to `/api/lookup`.
- **Yahoo egress 429 in local dev.** Same as the chart API. Mitigated by fixture-mode local
  resolution + debounce + per-endpoint rate keys + LRU/edge cache.
- **Supabase-saved selections** use the old shape — with no users (R7) we accept the break.

## Review responses (traceability)

### Review #1

| #   | Finding                                                               | Disposition                                                                                                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Phase 0 not check-clean; breaks legacy route/validator/fixtures/tests | **Accepted, twice refined** — delete dead legacy route+validator+test; list all consumers/tests per phase. Two parts later superseded: the "green at every phase boundary" framing → **review #2 Finding 2** (single green→green swap across Phases 0–5); and "keep `policy`" → **review #3 Finding 3** (`policy` replaced by an explicit `asset` field on `BenchmarkEntry`, then removed) |
| 2   | `onSelect(symbol)` discards remote metadata                           | **Accepted** — shared `SymbolSearchResult`, `onAdd(result)`, `symbolMeta` map, cold-load name resolution via lookup                                                                                                                                                                                                                                                                        |
| 3   | Searchable ≠ addable (`≥2`, fixture seed-only, unfiltered types)      | **Accepted** — Enter exact-resolve incl 1-char; filter to equity/etf/index; fixture synthetic-exact                                                                                                                                                                                                                                                                                        |
| 4   | "Full foreign coverage" vs global intersection                        | **Resolved** — Phase 1.5 replaces the inner-join with union + forward-fill (LOCF); no empty/clipped charts; identical output for identical-timestamp-set inputs (refined by review #4 Finding 6)                                                                                                                                                                                           |
| 5   | Verification too thin                                                 | **Accepted** — Testing section, tests-per-phase, `npm test`+`build`                                                                                                                                                                                                                                                                                                                        |
| 6   | Volume must keep anchor's own timestamps                              | **Accepted** — ship anchor raw bars, not intersection; fixes existing regression; tested                                                                                                                                                                                                                                                                                                   |
| 7   | Cap not enforced in parse                                             | **Accepted** — single exported `MAX_SYMBOLS`, clamp in parse, enforce in UI+endpoint                                                                                                                                                                                                                                                                                                       |
| 8   | Cloning lookup poisons cache on 429/5xx                               | **Accepted** — success/empty-only caching; fix lookup too                                                                                                                                                                                                                                                                                                                                  |
| 9   | Shared edge rate-limit budget                                         | **Accepted** — endpoint-scoped keys                                                                                                                                                                                                                                                                                                                                                        |
| 10  | No analytics for the new workflow                                     | **Accepted** — Phase 6 events, no raw query text                                                                                                                                                                                                                                                                                                                                           |

### Review #2

All eight verified against the code before incorporating; all accepted.

| #   | Sev      | Finding                                                                                                    | Disposition                                                                                                                                                                                                                                                                 |
| --- | -------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Critical | `SYMBOL_RE` rejects digit/9-char curated symbols (`^N225`, `^KS11`, `^STOXX50E`, `000001.SS`, `000300.SS`) | **Accepted** — shared `isValidSymbol` (BENCHMARKS keys ∪ broadened regex) replaces all four per-file regexes; round-trip test over every curated key. Confirmed real: `benchmarks.ts` has all five; `selection.ts:14`/`lookup:9` are letter-only                            |
| 2   | Critical | Phase 0 can't be check-clean while page (Phase 2) & AccountMenu (Phase 7) keep old shape                   | **Accepted** — dropped the false "green at every boundary" claim; Phases 0–5 are one green→green model swap; AccountMenu pulled into Phase 3; `SeriesKind` rename + `lineOptions` made atomic in Phase 0                                                                    |
| 3   | High     | Per-series rebasing compares different windows; conflicts with PLAN.md shared baseline                     | **Accepted** — Phase 1.5 adds `baseTime` (first union ts where all non-empty series have a value); all series rebased there; identical-timestamp sets → `baseTime` = window start = today (precision per review #4 Finding 6). Non-goal amended (normalization is in scope) |
| 4   | High     | `/api/lookup` falls back to top-ranked (`?? quotes[0]`) and doesn't filter unsupported exacts              | **Accepted** — exact-equality only (drop fallback → 404), filter to EQUITY/ETF/INDEX; tests for inexact-top and unsupported-exact. Confirmed at `lookup:134`                                                                                                                |
| 5   | High     | Deleting `/api/history` contradicts non-goal + leaves docs dangling                                        | **Accepted** — keep the deletion (no callers; only `validate.ts:57` self-refs), reword non-goal, update README:61 / PLAN:60,285,607 / cache-first:117 in Phase 7                                                                                                            |
| 6   | Medium   | R5.4/R6.1 stale vs resolved decisions                                                                      | **Accepted** — R5.4 → first equity else `symbols[0]`; R6.1 → `MAX_SYMBOLS` (set to **16** in review #4 per Finding 1)                                                                                                                                                       |
| 7   | Medium   | `SymbolSearchResult.type` collapses ETF/equity, omits exchange                                             | **Accepted** — split `asset:'EQUITY'\|'ETF'\|'INDEX'` (display) from `kind` (color) + optional `exchange`; threaded through search/lookup/symbolMeta/analytics                                                                                                              |
| 8   | Medium   | `?basis=total\|price` vs internal `total-return\|price-only`; no invalid handling                          | **Accepted** — shared `parseBasis`/`serializeBasis`; absent→default; endpoint 400s on malformed; tests for absent/valid/malformed                                                                                                                                           |

### Review #3

All seven verified against the code before incorporating; all accepted.

| #   | Sev      | Finding                                                                                                                                                             | Disposition                                                                                                                                                                                                                                                         |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Critical | Chart rebases to `baseTime` but `summary.pctChange` from each series' first real bar → numbers disagree (PLAN.md:490)                                               | **Accepted** — `summary.pctChange` = close at `baseTime` → last real close, matching the chart; test asserts summary == final rendered chart value. Confirmed PLAN.md:490 ("number next to the chart never disagrees with the chart itself")                        |
| 2   | High     | "Enter on no highlighted row" is unreachable — bits-ui `Command` auto-highlights the first item, so `F` adds `^FTSE` not Ford                                       | **Accepted** — dedicated **"Use exact symbol"** action independent of auto-highlight; primary below the 2-char threshold, deliberate (⌘/Ctrl-Enter) above it                                                                                                        |
| 3   | Medium   | Deriving `asset` from `BENCHMARKS.policy` re-introduces the coupling R4 retires (`fixtures.ts:75`)                                                                  | **Accepted, reverses review #2** — add explicit `asset:'INDEX'\|'ETF'` to `BenchmarkEntry`; repoint fixtures/browse/provisional-kind to it; `policy` now has no consumers → deleted. Confirmed `fixtures.ts:75` + only the to-be-removed basis helpers use `policy` |
| 4   | Medium   | Volume-anchor rule omits client consumers — `subscribeTooltip` gets the anchor via a page callback (`setup.ts:265`), so volume & tooltip could use different series | **Accepted** — server derives one anchor for `primaryVolume` **and** `meta.timezone`; client `getAnchorSymbol()` → `data.primaryVolume.symbol`; test index-first/equity-second. Confirmed page:422 returns `stocks[0]`, server couples both to `primarySymbol`      |
| 5   | Medium   | Parse specifies validate + clamp but not ordered dedup                                                                                                              | **Accepted** — normalize → drop invalid → dedupe (first wins) → clamp; case/whitespace dup tests                                                                                                                                                                    |
| 6   | Medium   | Final manual pass only checks autocomplete                                                                                                                          | **Accepted** — manual checklist: browse-on-focus, arrow nav, exact-add, Escape, selected/disabled rows, max-cap, last-series removal, narrow-width overflow (kept manual)                                                                                           |
| 7   | Medium   | "Names resolved lazily" ambiguous — eager resolution = up to 12 Yahoo calls on a cold link                                                                          | **Accepted** — on-demand only, bounded queue (≤2 concurrent), never blocks chart load; chart doesn't need names                                                                                                                                                     |

### Review #4

All eight verified against the code before incorporating; all accepted. (Per the user, **not** grandfathering saved users is an accepted decision the reviewer couldn't know — so Finding 2's migration-gate is declined; its code-robustness half is kept.)

| #   | Sev    | Finding                                                                                                              | Disposition                                                                                                                                                                                                                                               |
| --- | ------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High   | `MAX_SYMBOLS = 12` cuts capacity 16 → 12, contradicting "no regression in limits"                                    | **Accepted** — set **`MAX_SYMBOLS = 16`** (= old 8 + 8); also keeps cache-first's 16×5=80-key LRU sizing valid. Confirmed cache plan sizes to 16 (`:122,127,…`)                                                                                           |
| 2   | High   | `AccountMenu` casts stored JSON without parsing (`:75`, `applySaved :100–101`) → legacy row runtime-invalid          | **Accepted (robustness only)** — route the read through shared `parseSelection` so a stale/garbage row is skipped/defaulted, not crashed on. **No** version/migrate/dual-read gate — zero saved rows (user-confirmed), break accepted per R7              |
| 3   | High   | Phase 7 fixed one line; both linked plans still assume two routes / 16 / `policy` / inner-join                       | **Accepted** — new Phase 7 step 23: superseded-by banner + targeted fixes on **both** `cache-first` (routes/key; 16-sizing stays valid) and `static-data` (`asset` not `policy`; union+LOCF not `intersectionTimes`). Confirmed both plans stale          |
| 4   | High   | `symbolMeta` claims `name`/`asset` from `data.series`, but response has only `kind`+currency; lazy queue unspecified | **Accepted** — server now emits `asset` per series; `symbolMeta` typed **partial** `{ kind; asset?; name? }`; `name` via a memoized, in-flight-deduped, ≤2-concurrent `nameResolver` with unit tests. Confirmed response shape at `history-multi:274–284` |
| 5   | High   | Empty `aligned` + `windowedPctChange`→`0` shows "0%" beside an absent line                                           | **Accepted** — `windowedPctChange` returns `number \| undefined`; `pctChange` optional; SeriesList renders **"—"**; route + UI tests (one empty, one valid). Confirmed `normalize.ts:30` returns `0` for `<2` points                                      |
| 6   | Medium | "single-calendar unchanged" is only true for identical timestamp sets (IPO/halt/missing bar differ)                  | **Accepted** — reworded everywhere to **"identical timestamp sets"**; added a sparse-same-session LOCF test documenting the intended divergence from inner-join                                                                                           |
| 7   | Medium | ≥2-char exact behavior unresolved ("deliberately or via a modifier"); checklist covers only 1-char                   | **Accepted** — exact item pinned in its own group **below matches**; **⌘/Ctrl+Enter** fires exact-add regardless of highlight; test a valid long-tail symbol absent from search's top-6; checklist updated                                                |
| 8   | Medium | Components placed under `ui/` vs the real `src/lib/components/ui/`                                                   | **Accepted** — path-convention note + Files-touched table rewritten to full `src/…` paths; inline shorthand mapped explicitly                                                                                                                             |
