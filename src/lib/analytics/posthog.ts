import posthog from 'posthog-js';
import { browser } from '$app/environment';
import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from '$env/static/public';
import { sanitizePageviewProperties, resolveStoredConsent } from './scrub.js';
import type { AnalyticsConsent, StoredConsent } from './scrub.js';

export type { AnalyticsConsent };

// Analytics are fully optional and env-gated: with no PUBLIC_POSTHOG_KEY set
// (e.g. local dev, or before the PostHog project exists) every function here
// is a no-op, so the app ships and runs identically with or without it.
//
// Keep collection deliberately minimal: anonymous, cookieless pageviews only.
// In particular, do not call identify() or send account IDs/email addresses.
//
// Consent model is opt-out: because collection is cookieless (nothing is stored
// on or read from the device), ePrivacy Art. 5(3) consent is not triggered, and
// the transient processing runs under GDPR legitimate interest. Pageviews
// therefore flow by default and stop only when the visitor stores a 'rejected'
// choice via Privacy settings.
//
// Read via $env/static/public (inlined at build) rather than /dynamic/public:
// on the Cloudflare adapter, dynamic public env is read from the Worker's
// *runtime* environment, but the PostHog key — like the Supabase config — is
// supplied as a Cloudflare *build* env var, so dynamic reads resolve to
// undefined in production and analytics silently never initialise.

const CONSENT_STORAGE_KEY = 'lift:analytics-consent';
const CONSENT_VERSION = 1;
let started = false;
let consent: AnalyticsConsent = 'unset';
let lastPageview = { url: '', at: 0 };

export function isAnalyticsConfigured(): boolean {
	return Boolean(PUBLIC_POSTHOG_KEY);
}

export function getAnalyticsConsent(): AnalyticsConsent {
	if (!browser || !isAnalyticsConfigured()) return 'unset';
	try {
		const resolved = resolveStoredConsent(
			localStorage.getItem(CONSENT_STORAGE_KEY),
			CONSENT_VERSION
		);
		if (resolved !== 'unset') consent = resolved;
		return resolved;
	} catch {
		return 'unset';
	}
}

export function setAnalyticsConsent(choice: Exclude<AnalyticsConsent, 'unset'>): void {
	consent = choice;
	if (!browser) return;
	try {
		const stored: StoredConsent = {
			version: CONSENT_VERSION,
			choice,
			updatedAt: new Date().toISOString()
		};
		localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(stored));
	} catch {
		// Keep the in-memory choice for this visit if browser storage is unavailable.
	}
}

export function initAnalytics(): void {
	if (!browser || started) return;
	if (!PUBLIC_POSTHOG_KEY) return;
	if (consent === 'unset') consent = getAnalyticsConsent();
	// Opt-out model: cookieless pageviews run under legitimate interest unless
	// the visitor has explicitly opted out.
	if (consent === 'rejected') return;
	posthog.init(PUBLIC_POSTHOG_KEY, {
		api_host: PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com',
		// We capture pageviews manually via afterNavigate so client-side route
		// changes (/, /docs, /auth/confirm) are all counted.
		capture_pageview: false,
		capture_pageleave: false,
		autocapture: false,
		capture_exceptions: false,
		disable_session_recording: true,
		disable_surveys: true,
		disable_web_experiments: true,
		// advanced_disable_feature_flags turns off flag *evaluation*, but the
		// /flags + remote-config network request is gated separately — disable
		// that too so a fresh load makes no request beyond the manual pageview.
		advanced_disable_feature_flags: true,
		advanced_disable_flags: true,
		person_profiles: 'never',
		cookieless_mode: 'always',
		// posthog-js defaults persistence to 'localStorage+cookie' and sets a
		// `ph_<token>_posthog` cookie. cookieless_mode is meant to suppress that,
		// but pin persistence to memory explicitly so no cookie or localStorage
		// entry is ever written — that "nothing touches the device" property is
		// what lets analytics run under legitimate interest without a consent gate.
		persistence: 'memory',
		// Defense in depth: reject every event except the one manual pageview
		// below, scrub query strings/fragments from URL-like properties, and
		// drop campaign/ad-click identifiers posthog-js pulls from the URL.
		before_send(event) {
			if (!event || event.event !== '$pageview') return null;
			event.properties = sanitizePageviewProperties(event.properties);
			return event;
		}
	});
	started = true;
}

export function capturePageview(): void {
	if (started && consent !== 'rejected') {
		// Exclude ticker selections in the query string from analytics.
		const url = `${window.location.origin}${window.location.pathname}`;
		const now = Date.now();
		// onMount and SvelteKit's initial afterNavigate can run back-to-back.
		if (lastPageview.url === url && now - lastPageview.at < 1_000) return;
		lastPageview = { url, at: now };
		posthog.capture('$pageview', { $current_url: url });
	}
}

/**
 * Capture a product event (e.g. a symbol add). Consent-gated like the pageview.
 * Note: the privacy-hardened `before_send` above forwards only `$pageview`, so
 * these events are currently dropped on the wire — the call sites are kept for
 * intent, and product analytics re-enables in one place (loosen `before_send`,
 * extend the scrub, and update the privacy copy) if it's ever wanted.
 */
export function captureEvent(name: string, props?: Record<string, unknown>): void {
	if (started && consent !== 'rejected') posthog.capture(name, props);
}
