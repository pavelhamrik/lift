type Entry<V> = {
	value: V;
	expiresAt: number;
};

export class LRUCache<V> {
	private store = new Map<string, Entry<V>>();
	private max: number;
	private ttlMs: number;

	constructor(opts: { max?: number; ttlMs?: number } = {}) {
		this.max = opts.max ?? 500;
		this.ttlMs = opts.ttlMs ?? 5 * 60_000;
	}

	get(key: string): V | undefined {
		const entry = this.store.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt <= Date.now()) {
			this.store.delete(key);
			return undefined;
		}
		this.store.delete(key);
		this.store.set(key, entry);
		return entry.value;
	}

	set(key: string, value: V): void {
		if (this.store.has(key)) this.store.delete(key);
		this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
		while (this.store.size > this.max) {
			const oldest = this.store.keys().next().value;
			if (oldest === undefined) break;
			this.store.delete(oldest);
		}
	}

	size(): number {
		return this.store.size;
	}

	clear(): void {
		this.store.clear();
	}
}
