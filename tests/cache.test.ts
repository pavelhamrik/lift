import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LRUCache } from '../src/lib/server/cache.js';

describe('LRUCache', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('returns stored values', () => {
		const c = new LRUCache<string>({ max: 2, ttlMs: 1000 });
		c.set('a', '1');
		expect(c.get('a')).toBe('1');
	});

	it('evicts oldest when over max', () => {
		const c = new LRUCache<string>({ max: 2, ttlMs: 60_000 });
		c.set('a', '1');
		c.set('b', '2');
		c.set('c', '3');
		expect(c.get('a')).toBeUndefined();
		expect(c.get('b')).toBe('2');
		expect(c.get('c')).toBe('3');
	});

	it('touches on get so LRU is real', () => {
		const c = new LRUCache<string>({ max: 2, ttlMs: 60_000 });
		c.set('a', '1');
		c.set('b', '2');
		c.get('a');
		c.set('c', '3');
		expect(c.get('a')).toBe('1');
		expect(c.get('b')).toBeUndefined();
	});

	it('expires entries past TTL', () => {
		const c = new LRUCache<string>({ max: 10, ttlMs: 500 });
		c.set('a', '1');
		vi.advanceTimersByTime(501);
		expect(c.get('a')).toBeUndefined();
	});
});
