import type { Bar } from '$lib/providers/types.js';

export type ClosePoint = { time: number; close: number };

export function innerJoinByTime(
	target: Bar[],
	benchmark: Bar[]
): { target: ClosePoint[]; benchmark: ClosePoint[] } {
	const bMap = new Map<number, number>();
	for (const b of benchmark) bMap.set(b.time, b.close);
	const tOut: ClosePoint[] = [];
	const bOut: ClosePoint[] = [];
	for (const t of target) {
		const bc = bMap.get(t.time);
		if (bc === undefined) continue;
		tOut.push({ time: t.time, close: t.close });
		bOut.push({ time: t.time, close: bc });
	}
	return { target: tOut, benchmark: bOut };
}

/**
 * Union + forward-fill (LOCF) alignment with a common baseline.
 *
 * Builds the union of every series' in-window timestamps, then carries each
 * series' last real close forward across timestamps it is missing. Before a
 * series' first real bar there is no value to carry, so those timestamps are
 * left empty (rendered as leading whitespace). Replaces the old inner-join,
 * which dropped any timestamp not shared by *every* series.
 *
 * `baseTime` = the first union timestamp at which every non-empty series has a
 * value (= max of each series' first-real-bar timestamp). Rebasing every series
 * to its close at `baseTime` puts them all on one apples-to-apples baseline.
 *
 * When every symbol shares the *identical* set of timestamps, the union equals
 * the intersection, fill never fires, and `baseTime` is the window start — so
 * the output matches the old inner-join exactly.
 */
export function unionForwardFill(barsBySymbol: Map<string, Bar[]>): {
	times: number[];
	baseTime: number;
	aligned: Map<string, ClosePoint[]>;
} {
	const timeSet = new Set<number>();
	for (const bars of barsBySymbol.values()) {
		for (const b of bars) timeSet.add(b.time);
	}
	const times = [...timeSet].sort((a, b) => a - b);

	const aligned = new Map<string, ClosePoint[]>();

	// baseTime = max over non-empty series of each series' first-real-bar time.
	let baseTime = -Infinity;
	let anyNonEmpty = false;
	for (const bars of barsBySymbol.values()) {
		if (bars.length === 0) continue;
		anyNonEmpty = true;
		let first = bars[0].time;
		for (const b of bars) if (b.time < first) first = b.time;
		if (first > baseTime) baseTime = first;
	}
	if (!anyNonEmpty) {
		for (const sym of barsBySymbol.keys()) aligned.set(sym, []);
		return { times, baseTime: times[0] ?? 0, aligned };
	}

	for (const [sym, bars] of barsBySymbol) {
		if (bars.length === 0) {
			aligned.set(sym, []);
			continue;
		}
		const byTime = new Map<number, number>();
		let first = bars[0].time;
		for (const b of bars) {
			byTime.set(b.time, b.close);
			if (b.time < first) first = b.time;
		}
		const out: ClosePoint[] = [];
		let lastClose: number | undefined;
		for (const t of times) {
			if (t < first) continue; // leading whitespace — nothing to carry yet
			const real = byTime.get(t);
			if (real !== undefined) {
				lastClose = real;
				out.push({ time: t, close: real });
			} else if (lastClose !== undefined) {
				out.push({ time: t, close: lastClose }); // LOCF
			}
		}
		aligned.set(sym, out);
	}

	return { times, baseTime, aligned };
}

/**
 * Rebase a series to 0% at `baseTime` (the common baseline). Points before
 * `baseTime` keep their values relative to it, so a longer series reads relative
 * to the shared start. Without `baseTime`, rebases to the first point (legacy).
 */
export function pctChangeSeries(
	points: ClosePoint[],
	baseTime?: number
): { time: number; value: number }[] {
	if (points.length === 0) return [];
	let base = points[0].close;
	if (baseTime !== undefined) {
		const bp = points.find((p) => p.time === baseTime);
		if (bp) base = bp.close;
	}
	if (!Number.isFinite(base) || base === 0) return [];
	return points.map((p) => ({ time: p.time, value: ((p.close - base) / base) * 100 }));
}

/**
 * Windowed % change over the rendered span: close at `baseTime` (the common
 * baseline) → last point. Because LOCF carries the last *real* close forward,
 * the final point equals the last real close, so this matches the final
 * rendered chart value. Returns `undefined` (never `0`) for an empty or
 * single-point series, so an absent line shows "—" rather than a false "0%".
 */
export function windowedPctChange(points: ClosePoint[], baseTime?: number): number | undefined {
	if (points.length < 2) return undefined;
	let base = points[0].close;
	if (baseTime !== undefined) {
		const bp = points.find((p) => p.time === baseTime);
		if (bp) base = bp.close;
	}
	const last = points[points.length - 1].close;
	if (!Number.isFinite(base) || base === 0) return undefined;
	return ((last - base) / base) * 100;
}
