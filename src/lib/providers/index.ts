import type { PriceProvider } from './types.js';
import { defaultFetch, makeYahooProvider, type FetchChart } from './yahoo.js';
import { fixtureFetch } from './fixtures.js';

let cached: PriceProvider | null = null;

/**
 * True only under `vite dev` with `STOCK_FIXTURES=1` (i.e. `npm run dev:static`).
 * `import.meta.env.DEV` is a build-time literal — `false` in the production
 * Worker build — so this collapses to `false` there and `process.env` is never
 * touched in the prod bundle. Read `process.env` directly (not `$env`); the
 * providers are server-only, so there is no client breakage.
 */
export function isFixtureMode(): boolean {
	return import.meta.env.DEV && process.env.STOCK_FIXTURES === '1';
}

/**
 * The single source of truth for "real vs. fixture" upstream bytes. Plan 2's
 * cache decorator wraps this same selector.
 */
export function getChartFetcher(): FetchChart {
	// The `import.meta.env.DEV` literal must guard the *only* static reference to
	// `fixtureFetch`: in the prod build it becomes `false`, so Rollup eliminates
	// this branch and tree-shakes `fixtures.ts` out of the Worker bundle.
	if (import.meta.env.DEV && isFixtureMode()) return fixtureFetch;
	return defaultFetch;
}

export function getProvider(): PriceProvider {
	if (!cached) cached = makeYahooProvider(getChartFetcher());
	return cached;
}

export type { PriceProvider } from './types.js';
