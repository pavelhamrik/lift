<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { afterNavigate, invalidate } from '$app/navigation';
	import AnalyticsConsent from '$lib/components/AnalyticsConsent.svelte';
	import { analyticsPanel } from '$lib/analytics/consent-panel.svelte.js';
	import {
		initAnalytics,
		capturePageview,
		getAnalyticsConsent,
		isAnalyticsConfigured,
		setAnalyticsConsent,
		type AnalyticsConsent as AnalyticsConsentValue
	} from '$lib/analytics/posthog.js';

	let { data, children } = $props();
	let analyticsConsent = $state<AnalyticsConsentValue>('unset');
	let showFirstRunNotice = $state(false);

	// One panel, shown either as the one-time first-run notice or when the visitor
	// opens it from the overflow ("⋯") menu. Its only real state is on vs opted
	// out, driven by `analyticsConsent`.
	const consentUiVisible = $derived(
		isAnalyticsConfigured() && (showFirstRunNotice || analyticsPanel.open)
	);

	onMount(() => {
		if (isAnalyticsConfigured()) {
			analyticsConsent = getAnalyticsConsent();
			// Opt-out model: cookieless pageviews run by default (legitimate
			// interest) unless the visitor has explicitly opted out.
			if (analyticsConsent !== 'rejected') {
				initAnalytics();
				capturePageview();
			}
			// Show the one-time notice only until the visitor acknowledges it.
			showFirstRunNotice = analyticsConsent === 'unset';
		}

		const {
			data: { subscription }
		} = data.supabase.auth.onAuthStateChange((_event, newSession) => {
			// Server and client sessions can drift (e.g. after a magic-link sign-in
			// in another tab); re-run the layout load to resync when they differ.
			if (newSession?.expires_at !== data.session?.expires_at) {
				invalidate('supabase:auth');
			}
		});
		return () => subscription.unsubscribe();
	});

	// Fires on initial load and every client-side navigation.
	afterNavigate(() => capturePageview());

	function applyAnalytics(choice: Exclude<AnalyticsConsentValue, 'unset'>) {
		setAnalyticsConsent(choice);
		analyticsConsent = choice;
		if (choice === 'accepted') {
			initAnalytics();
			capturePageview();
		}
		// Opting out: the capturePageview guard stops further pageviews this visit.
	}

	function closePanel() {
		showFirstRunNotice = false;
		analyticsPanel.close();
	}

	// "Opt out"/"Allow" record the choice and close. The ✕/Esc dismiss without
	// changing anything; dismissing a first-run notice with no explicit choice
	// records acknowledgement so it does not reappear, leaving analytics on (the
	// lawful default).
	function chooseAndClose(choice: Exclude<AnalyticsConsentValue, 'unset'>) {
		applyAnalytics(choice);
		closePanel();
	}
	function dismissPanel() {
		if (analyticsConsent === 'unset') applyAnalytics('accepted');
		closePanel();
	}
</script>

{@render children()}

{#if consentUiVisible}
	<AnalyticsConsent
		optedOut={analyticsConsent === 'rejected'}
		onOptOut={() => chooseAndClose('rejected')}
		onAllow={() => chooseAndClose('accepted')}
		onDismiss={dismissPanel}
	/>
{/if}
