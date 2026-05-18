import type { PriceProvider } from './types.js';
import { makeYahooProvider } from './yahoo.js';

let cached: PriceProvider | null = null;

export function getProvider(): PriceProvider {
	if (!cached) cached = makeYahooProvider();
	return cached;
}

export type { PriceProvider } from './types.js';
