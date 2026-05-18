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

export function pctChangeSeries(points: ClosePoint[]): { time: number; value: number }[] {
	if (points.length === 0) return [];
	const base = points[0].close;
	if (!Number.isFinite(base) || base === 0) return [];
	return points.map((p) => ({ time: p.time, value: ((p.close - base) / base) * 100 }));
}

export function windowedPctChange(points: ClosePoint[]): number {
	if (points.length < 2) return 0;
	const first = points[0].close;
	const last = points[points.length - 1].close;
	if (!Number.isFinite(first) || first === 0) return 0;
	return ((last - first) / first) * 100;
}
