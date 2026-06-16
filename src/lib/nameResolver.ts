export type NameFetcher = (symbol: string) => Promise<string | null>;

export type NameResolver = {
	/**
	 * Resolve a symbol's display name. Memoizes one request per symbol (a resolved
	 * OR failed symbol is never re-requested), dedupes concurrent asks for the same
	 * symbol onto one in-flight promise, and runs at most `maxConcurrent` requests
	 * at once (the rest queue). Returns `null` when the name can't be resolved.
	 */
	resolve(symbol: string): Promise<string | null>;
};

/**
 * Bounded, memoized, in-flight-deduped name resolver. The chart never depends on
 * names, so this exists only to fill in row labels on demand without fanning out
 * a burst of upstream calls on a cold shared link.
 */
export function createNameResolver(
	fetcher: NameFetcher,
	opts: { maxConcurrent?: number } = {}
): NameResolver {
	const maxConcurrent = opts.maxConcurrent ?? 2;
	const cache = new Map<string, string | null>(); // resolved or failed (null)
	const inFlight = new Map<string, Promise<string | null>>();
	const queue: Array<() => void> = [];
	let active = 0;

	function pump() {
		while (active < maxConcurrent && queue.length > 0) {
			const job = queue.shift()!;
			active++;
			job();
		}
	}

	function resolve(symbol: string): Promise<string | null> {
		const key = symbol.toUpperCase();
		if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
		const existing = inFlight.get(key);
		if (existing) return existing;

		const p = new Promise<string | null>((res) => {
			queue.push(() => {
				fetcher(key)
					.then((name) => {
						cache.set(key, name);
						res(name);
					})
					.catch(() => {
						cache.set(key, null);
						res(null);
					})
					.finally(() => {
						inFlight.delete(key);
						active--;
						pump();
					});
			});
		});
		inFlight.set(key, p);
		pump();
		return p;
	}

	return { resolve };
}
