# CLAUDE.md

Operational guidance for working in this repo. For product rationale read
`README.md` and `PLAN.md`; for cache internals read `docs/caching.md`.

## What this is

Lift — a SvelteKit app that overlays a US-listed stock against a benchmark on a
single normalized-percent chart. It compiles to a **single Cloudflare Worker**
via `@sveltejs/adapter-cloudflare` (Workers + Static Assets, _not_ Pages — chosen
so the Rate Limiting binding is available). Price data is Yahoo's public v8 chart
JSON, abstracted behind a `PriceProvider` interface. **Supabase is auth-only** and
is not in the price-data path.

## Deploy

**Cloudflare Workers Builds git integration: every push to `main` builds and
deploys automatically.** There is no GitHub Actions workflow and no manual
`wrangler deploy` step.

- Push/merge to `main` → Cloudflare runs `npm run build` (`wrangler types &&
vite build`) → deploys the `.svelte-kit/cloudflare/_worker.js` bundle.
- Config lives in `wrangler.jsonc` (worker name `lift`, `nodejs_compat`, the
  `RATE_LIMITER` binding). The build output dir doubles as `assets.directory`.
- **Implication: merging a PR to `main` ships to production.** Land changes via
  PR; never push to `main` casually.
- In-memory caches reset on every deploy (isolates boot cold). The edge cache
  (`caches.default`) is the durable cross-isolate layer. No warmup needed — the
  caches refill on first requests. See `docs/caching.md`.

## Commands

| Command              | What it does                                                   |
| -------------------- | -------------------------------------------------------------- |
| `npm run dev`        | live Yahoo data (often 429s on residential IPs)                |
| `npm run dev:static` | synthetic fixtures, **zero** Yahoo traffic — preferred locally |
| `npm run build`      | production Worker bundle                                       |
| `npm run preview`    | run the real Worker build via `wrangler dev`                   |
| `npm run check`      | `wrangler types` + `svelte-check` (typecheck)                  |
| `npm run lint`       | `prettier --check .` + `eslint .`                              |
| `npm test`           | unit + provider-contract suite (offline, deterministic)        |

Run `npm run check` and `npm test` before treating work as done. Note: fixtures
are tree-shaken out of any _build_, so only `vite dev` (`dev:static`) can serve
synthetic data — `preview`/`wrangler dev` always hit real Yahoo.

## Conventions & gotchas

- **`.env` is gitignored.** A `SessionStart` hook symlinks it from the main
  checkout into worktrees automatically. If `PUBLIC_SUPABASE_*` vars are missing
  and `npm run check` errors, that's why — never commit `.env`.
- **A `Stop` hook runs `svelte-check`** on any turn that left changes; keep the
  tree typechecking green.
- **Commits**: Conventional-commit style (`feat(scope): …`), squash-merged with
  the PR number appended (`… (#N)`).
- **Provider boundary**: swap or extend data sources inside
  `src/lib/providers/`. The raw-fetch cache decorator sits at the `FetchChart`
  seam beneath `makeYahooProvider` (`src/lib/server/cached-fetch.ts`).
- **Don't reformat files outside your change's scope** — several files
  pre-existingly fail Prettier on `main`; leave them unless the task _is_ a lint
  cleanup.

## Where things live

- Routes & API endpoints — `src/routes/`, `src/routes/api/`
- Provider interface + Yahoo mapping — `src/lib/providers/`
- Server caches / throttle / rate-limit — `src/lib/server/`
- Chart + UI components — `src/lib/chart/`, `src/lib/components/`
- Design docs — `docs/plans/`; cache reference — `docs/caching.md`
