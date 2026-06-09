<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { afterNavigate, invalidate } from '$app/navigation';
	import {
		initAnalytics,
		capturePageview,
		identifyUser,
		resetAnalytics
	} from '$lib/analytics/posthog.js';

	let { data, children } = $props();

	onMount(() => {
		initAnalytics();
		// If we already have a session on first load, attribute analytics to them.
		if (data.user) identifyUser(data.user.id, data.user.email ?? undefined);

		const {
			data: { subscription }
		} = data.supabase.auth.onAuthStateChange((event, newSession) => {
			if (event === 'SIGNED_OUT') resetAnalytics();
			else if (newSession?.user) {
				identifyUser(newSession.user.id, newSession.user.email ?? undefined);
			}
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
</script>

{@render children()}
