type Bucket = number[];

export class SlidingWindowThrottle {
	private buckets = new Map<string, Bucket>();
	private windowMs: number;
	private max: number;

	constructor(opts: { windowMs?: number; max?: number } = {}) {
		this.windowMs = opts.windowMs ?? 60_000;
		this.max = opts.max ?? 30;
	}

	take(key: string, now: number = Date.now()): { ok: boolean; retryAfterMs: number } {
		const cutoff = now - this.windowMs;
		const existing = this.buckets.get(key) ?? [];
		const recent = existing.filter((t) => t > cutoff);
		if (recent.length >= this.max) {
			const earliest = recent[0];
			return { ok: false, retryAfterMs: Math.max(0, earliest + this.windowMs - now) };
		}
		recent.push(now);
		this.buckets.set(key, recent);
		return { ok: true, retryAfterMs: 0 };
	}

	reset(): void {
		this.buckets.clear();
	}
}
