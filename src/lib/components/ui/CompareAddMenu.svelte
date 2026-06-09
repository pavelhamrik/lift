<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import {
		BENCHMARK_GROUP_LABELS,
		groupedBenchmarks,
		type BenchmarkSymbol
	} from '$lib/benchmarks.js';
	import { cn } from '$lib/utils.js';

	type Props = {
		excluded: BenchmarkSymbol[];
		onAdd: (symbol: BenchmarkSymbol) => void;
		disabled?: boolean;
	};

	let { excluded, onAdd, disabled = false }: Props = $props();

	const sections = groupedBenchmarks();

	function isExcluded(sym: BenchmarkSymbol): boolean {
		return excluded.includes(sym);
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		{disabled}
		aria-label="Add comparison"
		class={cn(
			'group inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium tracking-wide transition-colors',
			'border-dashed border-(--color-input) text-(--color-muted-foreground)',
			'hover:border-(--color-muted-foreground)/60 hover:text-(--color-foreground)',
			'focus:outline-none focus:border-(--color-ring)',
			'data-[state=open]:border-(--color-ring) data-[state=open]:text-(--color-foreground)',
			'disabled:cursor-not-allowed disabled:opacity-50'
		)}
	>
		<svg
			viewBox="0 0 20 20"
			class="h-3.5 w-3.5"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M10 4v12M4 10h12" />
		</svg>
		<span>Compare</span>
	</DropdownMenu.Trigger>

	<DropdownMenu.Portal>
		<DropdownMenu.Content
			sideOffset={6}
			align="start"
			class={cn(
				'z-50 min-w-[16rem] max-h-[min(70vh,420px)] overflow-y-auto',
				'rounded-[var(--radius)] border shadow-md',
				'bg-(--color-popover) text-(--color-popover-foreground)',
				'border-(--color-border)',
				'p-1 outline-none'
			)}
		>
			{#each sections as section, sectionIndex (section.group)}
				{#if sectionIndex > 0}
					<DropdownMenu.Separator
						class="my-1 h-px bg-(--color-border)"
					/>
				{/if}
				<DropdownMenu.Group>
					<DropdownMenu.GroupHeading
						class="px-2 py-1 text-[11px] font-medium tracking-wide text-(--color-muted-foreground) uppercase"
					>
						{BENCHMARK_GROUP_LABELS[section.group]}
					</DropdownMenu.GroupHeading>
					{#each section.entries as { symbol, entry } (symbol)}
						<DropdownMenu.Item
							disabled={isExcluded(symbol)}
							onSelect={() => onAdd(symbol)}
							class={cn(
								'relative flex w-full cursor-default items-center justify-between gap-2',
								'rounded-[calc(var(--radius)-2px)] py-1.5 pr-2 pl-2 text-sm select-none',
								'data-[highlighted]:bg-(--color-muted) data-[highlighted]:text-(--color-foreground)',
								'data-[disabled]:opacity-40 data-[disabled]:pointer-events-none',
								'outline-none'
							)}
						>
							<span class="truncate">{entry.label}</span>
							<span class="text-[11px] text-(--color-muted-foreground)">{entry.currency}</span>
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Group>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
