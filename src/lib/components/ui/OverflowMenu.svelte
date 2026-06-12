<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { cn } from '$lib/utils.js';
	import type { ThemeStore, ThemeMode } from '$lib/theme/mode.svelte.js';

	type Props = {
		loading: boolean;
		onRefresh: () => void;
		onReset: () => void;
		theme: ThemeStore;
		themeOptions: ThemeMode[];
	};

	let { loading, onRefresh, onReset, theme, themeOptions }: Props = $props();

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
			<DropdownMenu.Item disabled={loading} onSelect={onRefresh} class={itemClass}>
				<svg
					viewBox="0 0 24 24"
					class={cn('h-4 w-4 shrink-0', loading && 'animate-spin')}
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M21 12a9 9 0 1 1-3.51-7.13" />
					<path d="M21 4v5h-5" />
				</svg>
				<span>Refresh</span>
			</DropdownMenu.Item>

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

			<DropdownMenu.Item class={itemClass}>
				{#snippet child({ props })}
					<a href="/docs" {...props}>
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

			<DropdownMenu.Separator class="my-1 h-px bg-(--color-border)" />

			<div class="flex items-center justify-between gap-2 px-2 py-1.5">
				<span
					class="text-[11px] font-medium tracking-wide text-(--color-muted-foreground) uppercase"
				>
					Theme
				</span>
				<div
					class="inline-flex items-center gap-0.5 rounded-full border p-0.5"
					style="border-color: var(--color-border)"
					role="radiogroup"
					aria-label="Theme"
				>
					{#each themeOptions as m (m)}
						<button
							type="button"
							role="radio"
							aria-checked={theme.mode === m}
							aria-label={m}
							title={m}
							class={cn(
								'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors',
								theme.mode === m
									? 'bg-(--color-accent) text-(--color-foreground)'
									: 'text-(--color-muted-foreground) hover:bg-(--color-accent) hover:text-(--color-foreground)'
							)}
							onclick={(e) => {
								theme.setMode(m);
								(e.currentTarget as HTMLButtonElement).blur();
							}}
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
						</button>
					{/each}
				</div>
			</div>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
