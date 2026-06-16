# Lift

A SvelteKit app that overlays up to 16 stocks, ETFs, and indices on a single
normalized-percent chart — every series rebased to % change from the start of the
selected window, so they share one y-axis regardless of price level or currency —
with the first equity's volume in a sub-pane. Runs on Cloudflare Workers.

Instruments are added from one search field (instant local matches + debounced
Yahoo autocomplete, grouped by type); the default view is AAPL vs SPY. The full
selection is encoded in the URL for sharing, and signing in (Supabase) saves and
reloads your selections. Analytics are cookieless and consent-based.

- **Range**: 1D / 5D / 1M / 6M / YTD / 1Y / 5Y / MAX (default 1Y). Intraday
  ranges use 1-minute or 5-minute bars; daily ranges use daily bars; 5Y uses
  weekly; MAX uses monthly — all routed through the same `HistoryRequest`
  shape so target and benchmark always fetch with identical interval/session/
  adjusted/period.
- **Benchmarks**: 21 curated indices and ETF proxies across 4 regions (US, Europe,
  Asia-Pacific, Global), shown in the browse-on-focus panel alongside popular
  tickers — default `SPY` (S&P 500 ETF, total-return). Adjustment is bound to the benchmark
  entry and applied to both sides so the comparison stays on a single return basis
  (indices → price-only; ETFs → total-return). See `PLAN.md` for the full rationale.

  Two caveats from the cross-market expansion:
  - **Currencies are not FX-adjusted.** When you compare AAPL to FTSE 100, the
    overlay plots % change in each side's own currency. This matches how every
    broker compare-chart works; trying to FX-adjust the benchmark would introduce
    a second moving variable into the comparison.
  - **Intraday ranges (1D / 5D) won't overlap with non-US benchmarks.** Trading
    sessions don't coincide — AAPL is open while Nikkei is closed and vice-versa.
    Daily / weekly / monthly bars are normalized to the bar's exchange-local
    calendar date (UTC-midnight), so 1M+ ranges align correctly across sessions.

- **Provider**: Yahoo's JSON chart API, fetched directly behind a typed provider
  interface so swapping data sources stays local to `src/lib/providers/`.
  `yahoo-finance2` is a devDependency, used only to record test fixtures.

## Run locally

```
npm install
npm run dev          # live data from Yahoo
npm run dev:static   # synthetic data, never touches Yahoo
```

Then open the URL Vite prints. Search a ticker or index, add up to 16 series, and
toggle ranges from 1D to MAX.

### `dev:static` — Yahoo-independent local data

Yahoo rate-limits residential/VPN egress IPs (every chart request 429s, stickily),
which makes plain `npm run dev` painful locally. `npm run dev:static`
(`STOCK_FIXTURES=1 vite dev`) serves **synthetic** price data for any symbol and
range — instant, deterministic, and with **zero** Yahoo traffic.

Scope and caveats:

- **Yahoo-independent, not fully offline.** Only the upstream price/lookup bytes
  are faked; an authenticated layout still talks to Supabase as usual.
- **Real code path.** The synthetic bytes feed the same `makeYahooProvider` /
  `buildResultFromChart` pipeline, so windowing, adjusted-close selection,
  scope mapping, and intersection are all exercised for real.
- **Intraday parity.** Intraday ranges (1D / 5D) emit bars only inside each
  symbol's own exchange session, so an out-of-session window (e.g. 1D before the
  US open, or a cross-market intraday compare) can legitimately return empty —
  exactly as live would. Daily and longer ranges always populate.
- **Build modes always use the real provider.** `npm run preview` and
  `wrangler dev` run a _production_ build, where the fixtures are tree-shaken out
  entirely — so they hit real Yahoo regardless of the env var. The static toggle
  is `vite dev` only.

The chart endpoint is `GET /api/history-multi?symbols=AAPL,SPY&basis=total&range=1Y`
— one ordered `symbols` list (kind is derived per symbol: Yahoo `INDEX` → gray
dashed, else colored solid), a `basis` toggle (`total`/`price`), and a `range`.
It validates each symbol, clamps to `MAX_SYMBOLS`, aligns the series by union +
forward-fill on a common baseline, throttles per-IP (sliding window), caches the
response in-process (LRU + 1-min TTL), and — on Cloudflare Workers — also writes
to `caches.default` keyed by the request URL. Two helper endpoints back the
search box: `GET /api/search?q=…` (ranked, type-filtered matches) and
`GET /api/lookup?symbol=…` (exact single-symbol resolution).

## Build / preview / deploy

```
npm run build      # bundles for Cloudflare Workers (Static Assets target)
npm run preview    # local Workers preview via wrangler dev
```

`wrangler.jsonc` declares an `unsafe` Rate Limiting binding (`RATE_LIMITER`,
60 req / 60s). The binding is **not** consumed by the route yet; wiring it up is
the v1 launch checklist item once the project is deployed and you have a real
namespace ID from the CF dashboard.

## Test

```
npm test                     # unit + provider contract suite (offline, blocking)
npm run fixtures:refresh     # re-record raw yahoo-finance2 payloads under tests/providers/fixtures/
```

The contract suite runs against pinned raw `yahoo-finance2` chart responses for
`^GSPC`, `SPY`, `AAPL`, and `BRK.B`. If a fixture file is missing, the suite falls
back to a synthetic payload that exercises the canonical-shape mapping
(instrumentType → canonical `Asset`, monotonic timestamps, adjusted-close selection,
paired-fetch consistency). For true Yahoo-drift detection, record real fixtures with
`fixtures:refresh` and commit the JSON.

A live-provider smoke against the real Yahoo endpoint is intended to run as a
scheduled (non-blocking) job after launch — not in PR CI.

## Attribution

Charts powered by [TradingView Lightweight Charts](https://www.tradingview.com/). The
TradingView attribution is required on public pages where the chart is rendered.

## Legal

- Hosted-service terms: `/terms`
- Privacy policy: `/privacy`
- Source code: [MIT License](LICENSE)
- Analytics operator checklist: [docs/analytics-privacy.md](docs/analytics-privacy.md)

## Out of scope (v1)

Relative volume (rVol), FX-adjusted cross-currency comparison, and E2E / visual
tests. (Autocomplete, multi-symbol overlays, non-US instruments, accounts, and
saved selections — all once deferred — have since shipped.)
