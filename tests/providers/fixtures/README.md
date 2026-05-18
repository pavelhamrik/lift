# Provider fixtures

Pinned raw `yahoo-finance2` chart responses for the contract suite.

Required tickers (kept in sync with the validation regex `^[A-Z\^.\-]{1,8}$`):

- `^GSPC` (`_GSPC.json`) — index benchmark, price-only adjustment policy.
- `SPY` (`SPY.json`) — ETF benchmark, total-return policy.
- `AAPL` (`AAPL.json`) — plain US equity with splits + dividends; exercises adjusted-close mapping.
- `BRK.B` (`BRK.B.json`) — dotted-class share; exercises the symbol-normalization path the regex admits.

If a fixture file is missing, the contract suite falls back to a synthetic payload that
exercises the canonical-shape mapping (instrumentType → asset, monotonic timestamps,
adjusted-close selection). That is enough to fail-fast on mapping regressions, but it
is **not** a substitute for recorded payloads — refresh real fixtures before treating
the suite as a Yahoo-drift gate.

## Refresh

```
npm run fixtures:refresh
```

Records full chart() responses for the tickers above. Review the diff in PR.
