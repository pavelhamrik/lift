<script lang="ts">
	import { resolve } from '$app/paths';
	import { cn } from '$lib/utils.js';

	type Props = {
		optedOut: boolean;
		onOptOut: () => void;
		onAllow: () => void;
		/** Dismiss without changing the current choice (the ✕, Esc, and "Got it"). */
		onDismiss: () => void;
		/** Focus the ✕ on mount — set only when opened from the menu, not the passive first-run notice. */
		autoFocus?: boolean;
	};

	let { optedOut, onOptOut, onAllow, onDismiss, autoFocus = false }: Props = $props();

	let dismissButton = $state<HTMLButtonElement | null>(null);

	// When opened from the menu, move focus to the ✕ so keyboard and screen-reader
	// users land inside the panel on the non-destructive control. The first-run
	// notice appears unsolicited, so it must not steal focus on page load.
	$effect(() => {
		if (autoFocus) dismissButton?.focus();
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onDismiss();
	}

	// Both choices share one quiet, equal-weight style — under the opt-out model
	// the visit is already counted lawfully, so neither option is "preferred".
	const buttonClass = cn(
		'inline-flex h-9 flex-1 items-center justify-center rounded-full border px-4 text-sm font-medium',
		'border-(--color-input) bg-(--color-card) text-(--color-card-foreground)',
		'transition-colors hover:bg-(--color-muted)',
		'focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)'
	);
</script>

<svelte:window onkeydown={onKeydown} />

<aside
	class="fixed bottom-3 left-3 z-50 w-[calc(100vw-1.5rem)] max-w-sm rounded-[var(--radius)] border bg-(--color-popover) p-4 text-(--color-popover-foreground) shadow-lg sm:bottom-5 sm:left-5"
	role="region"
	aria-label="Privacy settings"
>
	<button
		type="button"
		bind:this={dismissButton}
		onclick={onDismiss}
		class="absolute top-2.5 right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-(--color-muted-foreground) hover:bg-(--color-muted) hover:text-(--color-foreground) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
		aria-label="Dismiss"
		title="Dismiss"
	>
		<svg
			viewBox="0 0 20 20"
			class="h-3.5 w-3.5"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<path d="M5 5l10 10M15 5l-10 10" />
		</svg>
	</button>

	<p class="pr-7 text-sm leading-relaxed">
		{#if optedOut}
			You’ve opted out of anonymous usage analytics.
		{:else}
			We use privacy-friendly, cookieless analytics — anonymous pageviews and basic usage, like
			which symbols and ranges get used — to help improve the app. We don’t track you across
			websites or sell your data.
		{/if}
		<a href={resolve('/privacy')} class="text-(--color-foreground) underline underline-offset-2">
			Privacy details
		</a>
	</p>

	<div class="mt-3 flex gap-2">
		{#if optedOut}
			<button type="button" onclick={onAllow} class={buttonClass}>Allow</button>
		{:else}
			<button type="button" onclick={onOptOut} class={buttonClass}>Opt out</button>
		{/if}
		<button type="button" onclick={onDismiss} class={buttonClass}>Got it</button>
	</div>
</aside>
