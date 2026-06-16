<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { resolve } from '$app/paths';
	import { cn } from '$lib/utils.js';
	import { isAnalyticsConfigured } from '$lib/analytics/posthog.js';
	import { analyticsPanel } from '$lib/analytics/consent-panel.svelte.js';
	import type { ThemeStore, ThemeMode } from '$lib/theme/mode.svelte.js';

	type Props = {
		onReset: () => void;
		theme: ThemeStore;
		themeOptions: ThemeMode[];
	};

	let { onReset, theme, themeOptions }: Props = $props();

	const itemClass = cn(
		'relative flex w-full cursor-default items-center gap-2.5 no-underline',
		'rounded-[calc(var(--radius)-2px)] px-2 py-2 text-sm select-none',
		'text-(--color-popover-foreground)',
		'data-[highlighted]:bg-(--color-muted) data-[highlighted]:text-(--color-foreground)',
		'data-[disabled]:opacity-40 data-[disabled]:pointer-events-none',
		'outline-none'
	);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		aria-label="More actions"
		title="More actions"
		class={cn(
			'inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm',
			'bg-(--color-card) text-(--color-card-foreground) hover:bg-(--color-muted)',
			'border-(--color-input) transition-colors',
			'focus:border-(--color-ring) focus:outline-none',
			'data-[state=open]:border-(--color-ring)'
		)}
	>
		<svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor" aria-hidden="true">
			<circle cx="5" cy="12" r="1.6" />
			<circle cx="12" cy="12" r="1.6" />
			<circle cx="19" cy="12" r="1.6" />
		</svg>
	</DropdownMenu.Trigger>

	<DropdownMenu.Portal>
		<DropdownMenu.Content
			sideOffset={6}
			align="end"
			class={cn(
				'z-50 min-w-[14rem]',
				'rounded-[var(--radius)] border shadow-md',
				'bg-(--color-popover) text-(--color-popover-foreground)',
				'border-(--color-border)',
				'p-1 outline-none'
			)}
		>
			<DropdownMenu.Item onSelect={onReset} class={itemClass}>
				<svg
					viewBox="0 0 24 24"
					class="h-4 w-4 shrink-0"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<polyline points="1 4 1 10 7 10" />
					<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
				</svg>
				<span>Reset to defaults</span>
			</DropdownMenu.Item>

			<DropdownMenu.Separator class="my-1 h-px bg-(--color-border)" />

			<DropdownMenu.Item class={itemClass}>
				{#snippet child({ props })}
					<a href={resolve('/docs')} {...props}>
						<svg
							viewBox="0 0 24 24"
							class="h-4 w-4 shrink-0"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="9" />
							<path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5" />
							<circle cx="12" cy="17" r="0.6" fill="currentColor" />
						</svg>
						<span>Docs</span>
					</a>
				{/snippet}
			</DropdownMenu.Item>

			<DropdownMenu.Item class={itemClass}>
				{#snippet child({ props })}
					<a href={resolve('/about')} {...props}>
						<svg
							viewBox="0 0 24 24"
							class="h-4 w-4 shrink-0"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="9" />
							<path d="M12 11v5" />
							<path d="M12 8h.01" />
						</svg>
						<span>About</span>
					</a>
				{/snippet}
			</DropdownMenu.Item>

			<DropdownMenu.Separator class="my-1 h-px bg-(--color-border)" />

			<DropdownMenu.Item class={itemClass}>
				{#snippet child({ props })}
					<a href={resolve('/terms')} {...props}>
						<svg
							viewBox="0 0 24 24"
							class="h-4 w-4 shrink-0"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="m11 17 2 2a1 1 0 1 0 3-3" />
							<path
								d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"
							/>
							<path d="m21 3 1 11h-2" />
							<path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
							<path d="M3 4h8" />
						</svg>
						<span>Terms</span>
					</a>
				{/snippet}
			</DropdownMenu.Item>

			<DropdownMenu.Item class={itemClass}>
				{#snippet child({ props })}
					<a href={resolve('/privacy')} {...props}>
						<svg
							viewBox="0 0 24 24"
							class="h-4 w-4 shrink-0"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
						</svg>
						<span>Privacy policy</span>
					</a>
				{/snippet}
			</DropdownMenu.Item>

			{#if isAnalyticsConfigured()}
				<DropdownMenu.Item onSelect={() => analyticsPanel.openPanel()} class={itemClass}>
					<svg
						viewBox="0 0 24 24"
						class="h-4 w-4 shrink-0"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path
							d="M11 22c-3.806-1.45-7-3.966-7-9V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v4"
						/>
						<path d="M14.923 16.547 14 16.164" />
						<path d="m14.923 18.843-.923.383" />
						<path d="M16.547 14.923 16.164 14" />
						<path d="m16.547 20.467-.383.924" />
						<path d="m18.843 14.923.383-.923" />
						<path d="m19.225 21.391-.382-.924" />
						<path d="m20.467 16.547.923-.383" />
						<path d="m20.467 18.843.923.383" />
						<circle cx="17.695" cy="17.695" r="3" />
					</svg>
					<span>Privacy settings</span>
				</DropdownMenu.Item>
			{/if}

			<DropdownMenu.Separator class="my-1 h-px bg-(--color-border)" />

			<div class="flex items-center justify-between gap-2 px-2 py-1.5">
				<span
					class="text-[11px] font-medium tracking-wide text-(--color-muted-foreground) uppercase"
				>
					Theme
				</span>
				<DropdownMenu.RadioGroup
					value={theme.mode}
					onValueChange={(v) => theme.setMode(v as ThemeMode)}
					class="inline-flex items-center gap-0.5 rounded-full border p-0.5"
					style="border-color: var(--color-border)"
					aria-label="Theme"
				>
					{#each themeOptions as m (m)}
						<DropdownMenu.RadioItem
							value={m}
							closeOnSelect={false}
							aria-label={m}
							title={m}
							class={cn(
								'inline-flex h-7 w-7 cursor-default items-center justify-center rounded-full transition-colors outline-none',
								'text-(--color-muted-foreground)',
								'data-[highlighted]:bg-(--color-accent) data-[highlighted]:text-(--color-foreground)',
								'data-[state=checked]:bg-(--color-accent) data-[state=checked]:text-(--color-foreground)'
							)}
						>
							{#if m === 'system'}
								<svg
									viewBox="0 0 24 24"
									class="h-4 w-4"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<rect x="3" y="4" width="18" height="12" rx="2" />
									<path d="M8 20h8M12 16v4" />
								</svg>
							{:else if m === 'light'}
								<svg
									viewBox="0 0 24 24"
									class="h-4 w-4"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<circle cx="12" cy="12" r="4" />
									<path
										d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
									/>
								</svg>
							{:else}
								<svg
									viewBox="0 0 24 24"
									class="h-4 w-4"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
								</svg>
							{/if}
						</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
			</div>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
