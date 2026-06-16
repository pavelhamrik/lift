import { describe, it, expect } from 'vitest';
import {
	withoutQuery,
	sanitizePageviewProperties,
	sanitizeEventProperties,
	resolveStoredConsent,
	CAMPAIGN_PROPERTIES
} from '../src/lib/analytics/scrub.js';

describe('withoutQuery', () => {
	it('strips query string and fragment from absolute URLs', () => {
		expect(withoutQuery('https://lift.app/compare?symbols=AAPL,MSFT#section')).toBe(
			'https://lift.app/compare'
		);
	});

	it('leaves already-clean URLs untouched', () => {
		expect(withoutQuery('https://lift.app/docs')).toBe('https://lift.app/docs');
	});

	it('passes through non-string or empty values', () => {
		expect(withoutQuery(undefined)).toBe(undefined);
		expect(withoutQuery('')).toBe('');
		expect(withoutQuery(42)).toBe(42);
	});
});

describe('sanitizePageviewProperties', () => {
	it('removes ad-click + campaign identifiers and ticker query from a landing pageview', () => {
		const props = sanitizePageviewProperties({
			$current_url: 'https://lift.app/?gclid=abc&fbclid=def&utm_source=newsletter&symbols=AAPL',
			gclid: 'abc',
			fbclid: 'def',
			utm_source: 'newsletter',
			$browser: 'Chrome'
		});
		expect(props.gclid).toBeUndefined();
		expect(props.fbclid).toBeUndefined();
		expect(props.utm_source).toBeUndefined();
		// query (tickers + click ids) stripped from the URL itself...
		expect(props.$current_url).toBe('https://lift.app/');
		// ...while non-tracking technical context the policy discloses is kept.
		expect(props.$browser).toBe('Chrome');
	});

	it('strips identifiers nested in $set / $set_once and behind $initial_ prefixes', () => {
		const props = sanitizePageviewProperties({
			$initial_gclid: 'abc',
			$set_once: { $initial_fbclid: 'def', utm_medium: 'cpc' },
			$set: { gclid: 'ghi' }
		});
		expect(props.$initial_gclid).toBeUndefined();
		expect((props.$set_once as Record<string, unknown>).$initial_fbclid).toBeUndefined();
		expect((props.$set_once as Record<string, unknown>).utm_medium).toBeUndefined();
		expect((props.$set as Record<string, unknown>).gclid).toBeUndefined();
	});

	it('covers every known campaign property', () => {
		const props: Record<string, unknown> = {};
		for (const key of CAMPAIGN_PROPERTIES) props[key] = 'x';
		sanitizePageviewProperties(props);
		for (const key of CAMPAIGN_PROPERTIES) expect(props[key]).toBeUndefined();
	});

	it('returns undefined input unchanged', () => {
		expect(sanitizePageviewProperties(undefined)).toBeUndefined();
	});
});

describe('sanitizeEventProperties', () => {
	it('keeps deliberately-attached event props but scrubs the auto-attached URL', () => {
		// posthog-js auto-attaches $current_url to a product event fired from the
		// chart page, where it carries the ?stocks=…&compares=… ticker query string.
		const props = sanitizeEventProperties({
			symbol: 'AAPL',
			kind: 'stock',
			$current_url: 'https://lift.app/?stocks=AAPL,MSFT&compares=SPY',
			fbclid: 'def',
			utm_source: 'newsletter',
			$browser: 'Chrome'
		});
		// The event-specific data the call site attached survives...
		expect(props.symbol).toBe('AAPL');
		expect(props.kind).toBe('stock');
		// ...the URL is reduced to origin + path (ticker query dropped)...
		expect(props.$current_url).toBe('https://lift.app/');
		// ...campaign/ad-click identifiers are removed...
		expect(props.fbclid).toBeUndefined();
		expect(props.utm_source).toBeUndefined();
		// ...and disclosed technical context is kept.
		expect(props.$browser).toBe('Chrome');
	});

	it('returns undefined input unchanged', () => {
		expect(sanitizeEventProperties(undefined)).toBeUndefined();
	});
});

describe('resolveStoredConsent', () => {
	const VERSION = 1;

	it('returns unset for missing or malformed storage', () => {
		expect(resolveStoredConsent(null, VERSION)).toBe('unset');
		expect(resolveStoredConsent('not json', VERSION)).toBe('unset');
		expect(
			resolveStoredConsent(JSON.stringify({ version: VERSION, choice: 'maybe' }), VERSION)
		).toBe('unset');
	});

	it('round-trips a stored choice at the current version', () => {
		expect(
			resolveStoredConsent(JSON.stringify({ version: VERSION, choice: 'accepted' }), VERSION)
		).toBe('accepted');
		expect(
			resolveStoredConsent(JSON.stringify({ version: VERSION, choice: 'rejected' }), VERSION)
		).toBe('rejected');
	});

	it('preserves an explicit rejection across a consent-version bump', () => {
		expect(
			resolveStoredConsent(JSON.stringify({ version: VERSION, choice: 'rejected' }), VERSION + 1)
		).toBe('rejected');
	});

	it('re-confirms (unsets) an acceptance after a consent-version bump', () => {
		expect(
			resolveStoredConsent(JSON.stringify({ version: VERSION, choice: 'accepted' }), VERSION + 1)
		).toBe('unset');
	});
});
