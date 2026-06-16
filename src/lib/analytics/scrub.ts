// Dependency-free helpers for the analytics layer: URL/property scrubbing and
// stored-consent resolution. Deliberately free of posthog-js / SvelteKit imports
// so they stay unit-testable in the plain-node test project.

export type AnalyticsConsent = 'accepted' | 'rejected' | 'unset';

export type StoredConsent = {
	version: number;
	choice: Exclude<AnalyticsConsent, 'unset'>;
	updatedAt: string;
};

// Cross-site campaign / ad-click identifiers that posthog-js extracts from the
// landing URL by default. They arrive on inbound links we don't control (e.g.
// Facebook auto-appends ?fbclid=… to links shared on its platform, with no ad
// spend involved), so strip them to keep analytics anonymous and cookieless —
// the property the no-consent-banner legitimate-interest basis depends on.
export const CAMPAIGN_PROPERTIES = [
	'utm_source',
	'utm_medium',
	'utm_campaign',
	'utm_content',
	'utm_term',
	'gclid',
	'gad_source',
	'gclsrc',
	'dclid',
	'gbraid',
	'wbraid',
	'fbclid',
	'msclkid',
	'twclid',
	'li_fat_id',
	'mc_cid',
	'igshid',
	'ttclid',
	'rdt_cid',
	'irclid',
	'_kx'
] as const;

// URL-like properties whose query string + fragment can carry ticker selections.
const URL_PROPERTIES = ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer'];

// Drop the query string and fragment from a URL-like value. Non-string or empty
// inputs pass through unchanged.
export function withoutQuery(value: unknown): unknown {
	if (typeof value !== 'string' || !value) return value;
	try {
		const url = new URL(value);
		return `${url.origin}${url.pathname}`;
	} catch {
		return value.split('?')[0].split('#')[0];
	}
}

function deleteCampaignKeys(bag: unknown): void {
	if (!bag || typeof bag !== 'object') return;
	const record = bag as Record<string, unknown>;
	for (const key of CAMPAIGN_PROPERTIES) {
		delete record[key];
		delete record[`$initial_${key}`];
	}
}

// Scrub an event's properties in place: strip query/fragment from URL-like
// values and remove campaign/ad-click identifiers, including any that posthog-js
// stashed under $set / $set_once or behind an $initial_ prefix. Applied to every
// event we forward — the manual $pageview and the product-event allowlist alike —
// so the only event-specific data that leaves the browser is what a call site
// deliberately attaches (a ticker symbol, a range label). In particular the
// $current_url posthog-js auto-attaches to product events fired from the chart
// page would otherwise carry the ?stocks=…&compares=… ticker query string; this
// reduces it to origin + path.
function scrubProperties<T extends Record<string, unknown> | undefined>(properties: T): T {
	if (!properties) return properties;
	const record = properties as Record<string, unknown>;
	for (const key of URL_PROPERTIES) {
		if (key in record) record[key] = withoutQuery(record[key]);
	}
	deleteCampaignKeys(record);
	deleteCampaignKeys(record.$set);
	deleteCampaignKeys(record.$set_once);
	return properties;
}

// Named entry points for the two event classes we forward. They scrub
// identically today; keeping them distinct documents intent at each call site and
// leaves room to diverge later (e.g. a per-event property allowlist).
export const sanitizePageviewProperties = scrubProperties;
export const sanitizeEventProperties = scrubProperties;

// Resolve a stored consent record into an effective choice. An explicit opt-out
// ('rejected') PERSISTS across consent-version changes — a policy update must
// never silently re-enable analytics for someone who rejected. An 'accepted'
// choice is re-confirmed (treated as 'unset') when the version changes.
export function resolveStoredConsent(raw: string | null, currentVersion: number): AnalyticsConsent {
	if (!raw) return 'unset';
	try {
		const stored = JSON.parse(raw) as Partial<StoredConsent>;
		if (stored.choice !== 'accepted' && stored.choice !== 'rejected') return 'unset';
		if (stored.choice === 'rejected') return 'rejected';
		return stored.version === currentVersion ? 'accepted' : 'unset';
	} catch {
		return 'unset';
	}
}
