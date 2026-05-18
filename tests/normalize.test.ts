import { describe, it, expect } from 'vitest';
import { innerJoinByTime, pctChangeSeries, windowedPctChange } from '../src/lib/chart/normalize.js';

describe('innerJoinByTime', () => {
	it('keeps only timestamps present in both series', () => {
		const t = [
			{ time: 1, close: 10, volume: 0 },
			{ time: 2, close: 11, volume: 0 },
			{ time: 3, close: 12, volume: 0 }
		];
		const b = [
			{ time: 2, close: 100, volume: 0 },
			{ time: 3, close: 102, volume: 0 },
			{ time: 4, close: 105, volume: 0 }
		];
		const j = innerJoinByTime(t, b);
		expect(j.target.map((p) => p.time)).toEqual([2, 3]);
		expect(j.benchmark.map((p) => p.time)).toEqual([2, 3]);
		expect(j.target[0].close).toBe(11);
		expect(j.benchmark[1].close).toBe(102);
	});

	it('returns empty when no overlap', () => {
		const j = innerJoinByTime(
			[{ time: 1, close: 1, volume: 0 }],
			[{ time: 2, close: 1, volume: 0 }]
		);
		expect(j.target).toHaveLength(0);
		expect(j.benchmark).toHaveLength(0);
	});
});

describe('pctChangeSeries', () => {
	it('starts at 0% from the first close', () => {
		const s = pctChangeSeries([
			{ time: 1, close: 100 },
			{ time: 2, close: 110 },
			{ time: 3, close: 95 }
		]);
		expect(s[0].value).toBe(0);
		expect(s[1].value).toBeCloseTo(10, 9);
		expect(s[2].value).toBeCloseTo(-5, 9);
	});

	it('returns empty for empty input', () => {
		expect(pctChangeSeries([])).toHaveLength(0);
	});

	it('returns empty when base is 0', () => {
		const s = pctChangeSeries([
			{ time: 1, close: 0 },
			{ time: 2, close: 5 }
		]);
		expect(s).toHaveLength(0);
	});
});

describe('windowedPctChange', () => {
	it('computes (last-first)/first*100', () => {
		const v = windowedPctChange([
			{ time: 1, close: 50 },
			{ time: 2, close: 75 }
		]);
		expect(v).toBeCloseTo(50, 9);
	});

	it('returns 0 for <2 points', () => {
		expect(windowedPctChange([])).toBe(0);
		expect(windowedPctChange([{ time: 1, close: 10 }])).toBe(0);
	});
});
