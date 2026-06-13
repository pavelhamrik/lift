import posthog from 'posthog-js';
import { browser } from '$app/environment';
import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from '$env/static/public';

// Analytics are fully optional and env-gated: with no PUBLIC_POSTHOG_KEY set
// (e.g. local dev, or before the PostHog project exists) every function here
// is a no-op, so the app ships and runs identically with or without it.
//
// Read via $env/static/public (inlined at build) rather than /dynamic/public:
// on the Cloudflare adapter, dynamic public env is read from the Worker's
// *runtime* environment, but the PostHog key — like the Supabase config — is
// supplied as a Cloudflare *build* env var, so dynamic reads resolve to
// undefined in production and analytics silently never initialise.
let started = false;

export function initAnalytics(): void {
	if (!browser || started) return;
	if (!PUBLIC_POSTHOG_KEY) return;
	posthog.init(PUBLIC_POSTHOG_KEY, {
		api_host: PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com',
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
