import { describe, it, expect } from 'vitest';
import { SlidingWindowThrottle } from '../src/lib/server/throttle.js';

describe('SlidingWindowThrottle', () => {
	it('allows up to max within the window', () => {
		const t = new SlidingWindowThrottle({ windowMs: 1000, max: 3 });
		const start = 1_000;
		expect(t.take('ip', start).ok).toBe(true);
		expect(t.take('ip', start + 100).ok).toBe(true);
		expect(t.take('ip', start + 200).ok).toBe(true);
		expect(t.take('ip', start + 300).ok).toBe(false);
	});

	it('lets the window roll forward', () => {
		const t = new SlidingWindowThrottle({ windowMs: 1000, max: 2 });
		const start = 1_000;
		expect(t.take('ip', start).ok).toBe(true);
		expect(t.take('ip', start + 100).ok).toBe(true);
		expect(t.take('ip', start + 200).ok).toBe(false);
		expect(t.take('ip', start + 1101).ok).toBe(true);
	});

	it('keys independently per ip', () => {
		const t = new SlidingWindowThrottle({ windowMs: 1000, max: 1 });
		const at = 1_000;
		expect(t.take('a', at).ok).toBe(true);
		expect(t.take('a', at + 50).ok).toBe(false);
		expect(t.take('b', at + 50).ok).toBe(true);
	});

	it('reports retryAfter when blocked', () => {
		const t = new SlidingWindowThrottle({ windowMs: 1000, max: 1 });
		const at = 1_000;
		t.take('ip', at);
		const r = t.take('ip', at + 100);
		expect(r.ok).toBe(false);
		expect(r.retryAfterMs).toBeGreaterThan(0);
		expect(r.retryAfterMs).toBeLessThanOrEqual(1000);
	});
});
