import { describe, it, expect } from 'vitest';
import {
	innerJoinByTime,
	pctChangeSeries,
	windowedPctChange,
	unionForwardFill
} from '../src/lib/chart/normalize.js';
import type { Bar } from '../src/lib/providers/types.js';

const bar = (time: number, close: number): Bar => ({ time, close, volume: 0 });

describe('innerJoinByTime', () => {
	it('keeps only timestamps present in both series', () => {
		const t = [bar(1, 10), bar(2, 11), bar(3, 12)];
		const b = [bar(2, 100), bar(3, 102), bar(4, 105)];
		const j = innerJoinByTime(t, b);
		expect(j.target.map((p) => p.time)).toEqual([2, 3]);
		expect(j.benchmark.map((p) => p.time)).toEqual([2, 3]);
		expect(j.target[0].close).toBe(11);
		expect(j.benchmark[1].close).toBe(102);
	});

	it('returns empty when no overlap', () => {
		const j = innerJoinByTime([bar(1, 1)], [bar(2, 1)]);
		expect(j.target).toHaveLength(0);
		expect(j.benchmark).toHaveLength(0);
	});
});

describe('unionForwardFill', () => {
	it('unions timestamps, carries LOCF after first bar, omits the leading edge', () => {
		const m = new Map<string, Bar[]>([
			['A', [bar(1, 10), bar(2, 11), bar(3, 12)]],
			['B', [bar(2, 100), bar(3, 102), bar(4, 105)]]
		]);
		const { times, baseTime, aligned } = unionForwardFill(m);
		expect(times).toEqual([1, 2, 3, 4]);
		// A is missing t4 → carries its last real close (12) forward.
		expect(aligned.get('A')).toEqual([
			{ time: 1, close: 10 },
			{ time: 2, close: 11 },
			{ time: 3, close: 12 },
			{ time: 4, close: 12 }
		]);
		// B has no bar at t1 (before its first) → leading edge omitted, starts at t2.
		expect(aligned.get('B')).toEqual([
			{ time: 2, close: 100 },
			{ time: 3, close: 102 },
			{ time: 4, close: 105 }
		]);
		// baseTime = max of first-real-bar times = max(1, 2) = 2.
		expect(baseTime).toBe(2);
	});

	it('identical timestamp sets reproduce the inner-join exactly (Finding 6)', () => {
		const a = [bar(1, 10), bar(2, 11), bar(3, 12)];
		const b = [bar(1, 100), bar(2, 110), bar(3, 120)];
		const { times, baseTime, aligned } = unionForwardFill(
			new Map([
				['A', a],
				['B', b]
			])
		);
		const ij = innerJoinByTime(a, b);
		expect(times).toEqual([1, 2, 3]);
		// union == intersection, no fill, baseTime == window start.
		expect(baseTime).toBe(1);
		expect(aligned.get('A')).toEqual(ij.target);
		expect(aligned.get('B')).toEqual(ij.benchmark);
	});

	it('fills a sparse interior gap (same-session halt/missing bar) instead of dropping it', () => {
		// B is missing the interior t2 bar that A has — today's inner-join would
		// drop t2 from *both*; union+LOCF keeps it and carries B forward.
		const { aligned } = unionForwardFill(
			new Map([
				['A', [bar(1, 10), bar(2, 11), bar(3, 12)]],
				['B', [bar(1, 100), bar(3, 120)]]
			])
		);
		expect(aligned.get('B')).toEqual([
			{ time: 1, close: 100 },
			{ time: 2, close: 100 }, // LOCF over the gap
			{ time: 3, close: 120 }
		]);
	});

	it('a non-overlapping pair yields both series dense over the union (never empty)', () => {
		const { times, baseTime, aligned } = unionForwardFill(
			new Map([
				['A', [bar(1, 10), bar(2, 20)]],
				['B', [bar(3, 100), bar(4, 200)]]
			])
		);
		expect(times).toEqual([1, 2, 3, 4]);
		expect(baseTime).toBe(3); // later series' start
		expect(aligned.get('A')).toEqual([
			{ time: 1, close: 10 },
			{ time: 2, close: 20 },
			{ time: 3, close: 20 }, // flat LOCF segment
			{ time: 4, close: 20 }
		]);
		expect(aligned.get('B')).toEqual([
			{ time: 3, close: 100 },
			{ time: 4, close: 200 }
		]);
		expect(aligned.get('A')!.length).toBeGreaterThan(0);
		expect(aligned.get('B')!.length).toBeGreaterThan(0);
	});

	it('returns empties for an all-empty input', () => {
		const { times, aligned } = unionForwardFill(new Map([['A', []]]));
		expect(times).toEqual([]);
		expect(aligned.get('A')).toEqual([]);
	});
});

describe('common baseline (Finding 3)', () => {
	it('every series reads 0% at baseTime; a longer series rebases its pre-baseTime points', () => {
		const { baseTime, aligned } = unionForwardFill(
			new Map([
				['A', [bar(1, 10), bar(2, 11), bar(3, 12), bar(4, 12)]],
				['B', [bar(2, 100), bar(3, 102), bar(4, 105)]]
			])
		);
		expect(baseTime).toBe(2);
		const aPct = pctChangeSeries(aligned.get('A')!, baseTime);
		const bPct = pctChangeSeries(aligned.get('B')!, baseTime);
		// Both read 0% at baseTime.
		expect(aPct.find((p) => p.time === baseTime)!.value).toBe(0);
		expect(bPct.find((p) => p.time === baseTime)!.value).toBe(0);
		// A keeps its pre-baseTime point (t1), rebased to baseTime (negative).
		expect(aPct[0].time).toBe(1);
		expect(aPct[0].value).toBeCloseTo(((10 - 11) / 11) * 100, 9);
	});

	it('summary pctChange equals the final rendered chart value (Finding 1)', () => {
		const { baseTime, aligned } = unionForwardFill(
			new Map([
				['A', [bar(1, 10), bar(2, 11), bar(3, 12), bar(4, 12)]],
				['B', [bar(2, 100), bar(3, 102), bar(4, 105)]]
			])
		);
		for (const sym of ['A', 'B']) {
			const pts = aligned.get(sym)!;
			const summary = windowedPctChange(pts, baseTime);
			const chart = pctChangeSeries(pts, baseTime);
			expect(summary).toBeCloseTo(chart[chart.length - 1].value, 9);
		}
	});
});

describe('pctChangeSeries', () => {
	it('starts at 0% from the first close when no baseTime given', () => {
		const s = pctChangeSeries([
			{ time: 1, close: 100 },
			{ time: 2, close: 110 },
			{ time: 3, close: 95 }
		]);
		expect(s[0].value).toBe(0);
		expect(s[1].value).toBeCloseTo(10, 9);
		expect(s[2].value).toBeCloseTo(-5, 9);
	});

	it('rebases to the close at baseTime when given', () => {
		const s = pctChangeSeries(
			[
				{ time: 1, close: 100 },
				{ time: 2, close: 110 },
				{ time: 3, close: 121 }
			],
			2
		);
		expect(s.find((p) => p.time === 2)!.value).toBe(0);
		expect(s.find((p) => p.time === 3)!.value).toBeCloseTo(10, 9);
	});

	it('returns empty for empty input or zero base', () => {
		expect(pctChangeSeries([])).toHaveLength(0);
		expect(
			pctChangeSeries([
				{ time: 1, close: 0 },
				{ time: 2, close: 5 }
			])
		).toHaveLength(0);
	});
});

describe('windowedPctChange', () => {
	it('computes (last-base)/base*100', () => {
		const v = windowedPctChange([
			{ time: 1, close: 50 },
			{ time: 2, close: 75 }
		]);
		expect(v).toBeCloseTo(50, 9);
	});

	it('returns undefined (not 0) for <2 points — an absent line shows "—"', () => {
		expect(windowedPctChange([])).toBeUndefined();
		expect(windowedPctChange([{ time: 1, close: 10 }])).toBeUndefined();
	});
});
