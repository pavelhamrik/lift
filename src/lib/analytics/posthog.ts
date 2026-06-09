import posthog from 'posthog-js';
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

// Analytics are fully optional and env-gated: with no PUBLIC_POSTHOG_KEY set
// (e.g. local dev, or before the PostHog project exists) every function here
// is a no-op, so the app ships and runs identically with or without it.
let started = false;

export function initAnalytics(): void {
	if (!browser || started) return;
	const key = env.PUBLIC_POSTHOG_KEY;
	if (!key) return;
	posthog.init(key, {
		api_host: env.PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com',
		// We capture pageviews manually via afterNavigate so client-side route
		// changes (/, /docs, /auth/confirm) are all counted.
		capture_pageview: false,
		// Don't spend a person profile on every anonymous visitor; only build
		// profiles once someone signs in and we identify them.
		person_profiles: 'identified_only'
	});
	started = true;
}

export function capturePageview(): void {
	if (started) posthog.capture('$pageview');
}

/** Tie analytics to a signed-in user so "who signed up" maps to behaviour. */
export function identifyUser(id: string, email?: string): void {
	if (started) posthog.identify(id, email ? { email } : undefined);
}

export function resetAnalytics(): void {
	if (started) posthog.reset();
}
