// Cloudflare Workers Rate Limiting binding (declared as RATE_LIMITER in
// wrangler.jsonc). This is the primary per-IP edge control once deployed —
// per-CF-location and eventually consistent (see PLAN.md), so treat it as
// raising the cost of abuse, not as an authoritative global cap. The
// in-process SlidingWindowThrottle remains the dev/local best-effort layer.
export type EdgeRateLimiter = {
	limit(opts: { key: string }): Promise<{ success: boolean }>;
};

/**
 * Returns the bound rate limiter if present (i.e. running on Workers), else
 * undefined (e.g. `vite dev`, where the in-process throttle covers us).
 */
export function getRateLimiter(platform: App.Platform | undefined): EdgeRateLimiter | undefined {
	const env = platform?.env as Record<string, unknown> | undefined;
	const rl = env?.RATE_LIMITER;
	if (rl && typeof (rl as EdgeRateLimiter).limit === 'function') {
		return rl as EdgeRateLimiter;
	}
	return undefined;
}

/**
 * Checks the edge rate limiter for `key`. Returns a 429 Response when the
 * limit is exceeded, or null to proceed. No-op (returns null) off Workers.
 */
export async function checkEdgeRateLimit(
	platform: App.Platform | undefined,
	key: string
): Promise<Response | null> {
	const limiter = getRateLimiter(platform);
	if (!limiter) return null;
	try {
		const { success } = await limiter.limit({ key });
		if (success) return null;
		return new Response('Too Many Requests', {
			status: 429,
			headers: { 'Retry-After': '60' }
		});
	} catch (e) {
		// The edge limiter is a best-effort abuse control, never load-bearing for
		// correctness. If the binding misbehaves (rejects, or returns an
		// unexpected shape), fail open: log it and let the in-process
		// SlidingWindowThrottle remain the floor, rather than 500 the request.
		console.error('edge rate limiter failed; allowing request', e);
		return null;
	}
}
