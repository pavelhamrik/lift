import { describe, it, expect } from 'vitest';
import { createNameResolver } from '../src/lib/nameResolver.js';

/** A fetcher whose promises only settle when we explicitly release them. */
function deferredFetcher() {
	const releases: Array<(name: string | null) => void> = [];
	const calls: string[] = [];
	const fetcher = (symbol: string): Promise<string | null> => {
		calls.push(symbol);
		return new Promise<string | null>((resolve) => releases.push(resolve));
	};
	return { fetcher, calls, releaseAll: (v: string | null) => releases.forEach((r) => r(v)) };
}

describe('createNameResolver', () => {
	it('issues a single request for N concurrent asks of the same symbol (in-flight dedup)', async () => {
		const { fetcher, calls, releaseAll } = deferredFetcher();
		const r = createNameResolver(fetcher);
		const ps = [r.resolve('AAPL'), r.resolve('AAPL'), r.resolve('aapl')];
		expect(calls).toEqual(['AAPL']); // one request despite three asks
		releaseAll('Apple Inc.');
		expect(await Promise.all(ps)).toEqual(['Apple Inc.', 'Apple Inc.', 'Apple Inc.']);
	});

	it('never re-requests a resolved or failed symbol (memoized)', async () => {
		let n = 0;
		const r = createNameResolver(async (s) => {
			n++;
			return s === 'BAD' ? Promise.reject(new Error('nope')) : 'Name';
		});
		expect(await r.resolve('AAPL')).toBe('Name');
		expect(await r.resolve('AAPL')).toBe('Name');
		expect(await r.resolve('BAD')).toBeNull(); // failure cached as null
		expect(await r.resolve('BAD')).toBeNull();
		expect(n).toBe(2); // one call for AAPL, one for BAD — no re-requests
	});

	it('starts at most maxConcurrent immediately; queues the rest', async () => {
		const { fetcher, calls, releaseAll } = deferredFetcher();
		const r = createNameResolver(fetcher, { maxConcurrent: 2 });
		void ['A', 'B', 'C', 'D'].map((s) => r.resolve(s));
		expect(calls).toEqual(['A', 'B']); // only 2 in flight; C/D queued
		releaseAll('x'); // let the suite settle without hanging on queued jobs
	});

	it('never exceeds maxConcurrent in flight at any moment', async () => {
		let active = 0;
		let peak = 0;
		const r = createNameResolver(
			async (s) => {
				active++;
				peak = Math.max(peak, active);
				await Promise.resolve();
				await Promise.resolve();
				active--;
				return s;
			},
			{ maxConcurrent: 2 }
		);
		await Promise.all(['A', 'B', 'C', 'D', 'E'].map((s) => r.resolve(s)));
		expect(peak).toBe(2);
	});
});
