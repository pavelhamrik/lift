import type { InstrumentMeta } from '$lib/providers/types.js';

export function isTargetInScope(meta: InstrumentMeta): boolean {
	if (meta.country !== 'US') return false;
	return meta.asset === 'US_LISTED_EQUITY' || meta.asset === 'US_LISTED_ETF';
}
