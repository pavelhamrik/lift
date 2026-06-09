import type { InstrumentMeta } from '$lib/providers/types.js';

export function isTargetInScope(meta: InstrumentMeta): boolean {
	return meta.asset === 'EQUITY' || meta.asset === 'ETF' || meta.asset === 'INDEX';
}
