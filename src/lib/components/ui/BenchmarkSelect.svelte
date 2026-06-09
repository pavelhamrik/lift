<script lang="ts">
	import { Select } from 'bits-ui';
	import {
		BENCHMARKS,
		BENCHMARK_GROUP_LABELS,
		groupedBenchmarks,
		type BenchmarkSymbol
	} from '$lib/benchmarks.js';
	import { cn } from '$lib/utils.js';

	type Props = {
		value: BenchmarkSymbol;
		onValueChange: (v: BenchmarkSymbol) => void;
	};

	let { value = $bindable(), onValueChange }: Props = $props();

	const sections = groupedBenchmarks();

	function commit(v: string) {
		value = v as BenchmarkSymbol;
		onValueChange(v as BenchmarkSymbol);
	}
</script>

<Select.Root type="single" {value} onValueChange={commit}>
	<Select.Trigger
		aria-label="Benchmark"
		class={cn(
			'group inline-flex h-9 max-w-[18rem] items-center justify-between gap-2 rounded-[var(--radius)]',
			'border px-3 text-sm transition-colors',
			'bg-(--color-card) text-(--color-card-foreground)',
			'border-(--color-input) hover:border-(--color-muted-foreground)/40',
			'focus:border-(--color-ring) focus:outline-none',
			'data-[state=open]:border-(--color-ring)'
		)}
	>
		<span class="truncate">{BENCHMARKS[value]?.label ?? 'Select benchmark'}</span>
		<svg
			aria-hidden="true"
			viewBox="0 0 20 20"
			class="h-4 w-4 shrink-0 opacity-50 transition-transform group-data-[state=open]:rotate-180"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
		>
			<path d="M6 8l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	</Select.Trigger>

	<Select.Portal>
		<Select.Content
			sideOffset={6}
			class={cn(
				'z-50 min-w-[var(--bits-select-anchor-width)] max-h-[min(70vh,420px)] overflow-y-auto',
				'rounded-[var(--radius)] border shadow-md',
				'bg-(--color-popover) text-(--color-popover-foreground)',
				'border-(--color-border)',
				'p-1 outline-none'
			)}
		>
			<Select.Viewport>
				{#each sections as section (section.group)}
					<Select.Group>
						<Select.GroupHeading
							class="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-(--color-muted-foreground) uppercase"
						>
							{BENCHMARK_GROUP_LABELS[section.group]}
						</Select.GroupHeading>
						{#each section.entries as { symbol, entry } (symbol)}
							<Select.Item
								value={symbol}
								label={entry.label}
								class={cn(
									'relative flex w-full cursor-default items-center justify-between gap-2',
									'rounded-[calc(var(--radius)-2px)] py-1.5 pr-2 pl-2 text-sm select-none',
									'data-[highlighted]:bg-(--color-muted) data-[highlighted]:text-(--color-foreground)',
									'data-[selected]:font-medium',
									'outline-none'
								)}
							>
								<span class="truncate">{entry.label}</span>
								<span class="text-[11px] text-(--color-muted-foreground)">{entry.currency}</span>
							</Select.Item>
						{/each}
					</Select.Group>
				{/each}
			</Select.Viewport>
		</Select.Content>
	</Select.Portal>
</Select.Root>
