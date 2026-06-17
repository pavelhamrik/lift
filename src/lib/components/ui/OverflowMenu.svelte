<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { resolve } from '$app/paths';
	import { cn } from '$lib/utils.js';
	import { isAnalyticsConfigured } from '$lib/analytics/posthog.js';
	import { analyticsPanel } from '$lib/analytics/consent-panel.svelte.js';
	import type { ThemeStore, ThemeMode } from '$lib/theme/mode.svelte.js';
	import type { ReturnBasis } from '$lib/providers/types.js';

	type Props = {
		onReset: () => void;
		theme: ThemeStore;
		themeOptions: ThemeMode[];
		basis: ReturnBasis;
		onBasisChange: (basis: ReturnBasis) => void;
		intraday: boolean;
	};

	let { onReset, theme, themeOptions, basis, onBasisChange, intraday }: Props = $props();

	const basisOptions: Array<{ value: ReturnBasis; label: string }> = [
		{ value: 'price-only', label: 'Price' },
		{ value: 'total-return', label: 'Total' }
	];

	const itemClass = cn(
		'relative flex w-full cursor-default items-center gap-2.5 no-underline',
		'rounded-[calc(var(--radius)-4px)] px-2 py-2 text-sm select-none',
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
			'border-(--color-input) transition-[color,box-shadow]',
			'focus-ring',
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

			<div class="px-2 py-1.5">
				<span
					class="mb-1.5 flex items-center gap-1 text-[11px] font-medium tracking-wide text-(--color-muted-foreground) uppercase"
				>
					Return basis
					<span
						class="inline-flex cursor-help text-(--color-muted-foreground)"
						title="Most indices are price-only and ignore this toggle. ETF proxies (e.g. SPY) include dividends."
						aria-label="Most indices are price-only and ignore this toggle. ETF proxies like SPY include dividends."
					>
						<svg
							viewBox="0 0 24 24"
							class="h-3.5 w-3.5"
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
					</span>
				</span>
				<DropdownMenu.RadioGroup
					value={basis}
					onValueChange={(v) => onBasisChange(v as ReturnBasis)}
					class="flex items-center gap-0.5 rounded-full border p-0.5"
					style="border-color: var(--color-border)"
					aria-label="Return basis"
				>
					{#each basisOptions as opt (opt.value)}
						<DropdownMenu.RadioItem
							value={opt.value}
							closeOnSelect={false}
							disabled={intraday}
							title={opt.value === 'total-return' ? 'Dividend-adjusted total return' : 'Price only'}
							class={cn(
								'inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors outline-none',
								'cursor-default text-(--color-muted-foreground)',
								'data-[highlighted]:bg-(--color-accent) data-[highlighted]:text-(--color-foreground)',
								'data-[state=checked]:bg-(--color-accent) data-[state=checked]:text-(--color-foreground)',
								'data-[disabled]:pointer-events-none data-[disabled]:opacity-40'
							)}
						>
							{#if opt.value === 'price-only'}
								<svg
									viewBox="0 0 24 24"
									class="h-3.5 w-3.5"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<line x1="12" x2="12" y1="2" y2="22" />
									<path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
								</svg>
							{:else}
								<svg
									viewBox="0 0 24 24"
									class="h-3.5 w-3.5"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M8 4h8" />
									<path d="M8 9h12" />
									<path d="M8 14h6" />
									<path d="M4 3v13a2 2 0 0 0 2 2h15" />
									<path d="M18 15l3 3-3 3" />
								</svg>
							{/if}
							{opt.label}
						</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
				{#if intraday}
					<p class="mt-1.5 text-[11px] text-(--color-muted-foreground)">
						Intraday ranges are always price-only.
					</p>
				{/if}
			</div>

			<div class="px-2 py-1.5">
				<span
					class="mb-1.5 block text-[11px] font-medium tracking-wide text-(--color-muted-foreground) uppercase"
				>
					Theme
				</span>
				<DropdownMenu.RadioGroup
					value={theme.mode}
					onValueChange={(v) => theme.setMode(v as ThemeMode)}
					class="flex items-center gap-0.5 rounded-full border p-0.5"
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
								'inline-flex h-7 flex-1 cursor-default items-center justify-center rounded-full transition-colors outline-none',
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

			<DropdownMenu.Separator class="my-1 h-px bg-(--color-border)" />

			<DropdownMenu.Item class={itemClass}>
				{#snippet child({ props })}
					<a href={resolve('/docs')} {...props}>
						<span>Docs</span>
					</a>
				{/snippet}
			</DropdownMenu.Item>

			<DropdownMenu.Item class={itemClass}>
				{#snippet child({ props })}
					<a href={resolve('/about')} {...props}>
						<span>About</span>
					</a>
				{/snippet}
			</DropdownMenu.Item>

			<DropdownMenu.Separator class="my-1 h-px bg-(--color-border)" />

			<DropdownMenu.Item class={itemClass}>
				{#snippet child({ props })}
					<a href={resolve('/terms')} {...props}>
						<span>Terms</span>
					</a>
				{/snippet}
			</DropdownMenu.Item>

			<DropdownMenu.Item class={itemClass}>
				{#snippet child({ props })}
					<a href={resolve('/privacy')} {...props}>
						<span>Privacy policy</span>
					</a>
				{/snippet}
			</DropdownMenu.Item>

			{#if isAnalyticsConfigured()}
				<DropdownMenu.Item onSelect={() => analyticsPanel.openPanel()} class={itemClass}>
					<span>Privacy settings</span>
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
