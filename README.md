# stock-compare

A small SvelteKit web app that overlays a US-listed stock against an S&P 500 benchmark
on a single normalized-percent chart, with the target's volume in a sub-pane.

- **Range**: 1D (intraday 1m) or 1Y (daily)
- **Benchmark**: `SPY` (default, total-return) or `^GSPC` (price-only). Adjustment is
  bound to the benchmark and applied to both sides so the comparison stays on a
  single return basis. See `PLAN.md` for the full rationale.
- **Provider**: Yahoo via `yahoo-finance2`, abstracted behind a `PriceProvider`
  interface so swapping data sources stays local to `src/lib/providers/`.

## Run locally

```
npm install
npm run dev
```

Then open the URL Vite prints. Type a ticker, pick a benchmark, toggle 1D / 1Y.

The API endpoint is `GET /api/history?symbol=AAPL&benchmark=SPY&range=1Y`. It
canonicalizes the request, validates against the symbol regex and benchmark
allowlist, throttles per-IP (sliding window), caches the response in-process
(LRU + 1-min TTL), and — when running on Cloudflare Workers — also writes to
`caches.default` keyed by the canonical request URL.

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

## Out of scope (v1)

Autocomplete, multiple comparison targets, non-US listings, rVol, persistence beyond
theme preference, auth, E2E / visual tests.
