<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { SeriesKind } from '$lib/providers/types.js';

	type Props = {
		symbols: string[];
		kindFor: (symbol: string) => SeriesKind;
		colorFor: (symbol: string) => string;
		/** Windowed % change for the active range, or undefined if not yet loaded / absent. */
		summaryFor: (symbol: string) => number | undefined;
		nameFor: (symbol: string) => string | undefined;
		onRemove: (symbol: string) => void;
		onRequestName: (symbol: string) => void;
	};

	let { symbols, kindFor, colorFor, summaryFor, nameFor, onRemove, onRequestName }: Props =
		$props();

	const canRemove = $derived(symbols.length > 1);

	// On-demand name resolution: ask only for the rows actually rendered, and only
	// for those still missing a name (the resolver memoizes + bounds concurrency).
	$effect(() => {
		for (const s of symbols) {
			if (!nameFor(s)) onRequestName(s);
		}
	});

	function pctClass(v: number | undefined): string {
		if (v === undefined) return 'text-(--color-muted-foreground)';
		if (v > 0) return 'text-(--color-up)';
		if (v < 0) return 'text-(--color-down)';
		return 'text-(--color-foreground)';
	}

	function formatPct(v: number | undefined): string {
		if (v === undefined) return '—';
		const sign = v > 0 ? '+' : '';
		return `${sign}${v.toFixed(1)}%`;
	}
</script>

<div class="no-scrollbar flex max-w-full min-w-0 items-center gap-2 overflow-x-auto">
	{#each symbols as s (s)}
		{@const kind = kindFor(s)}
		<span
			class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border pr-1 pl-2.5 text-sm font-medium tabular-nums"
			style="border-color: var(--color-border)"
			title={nameFor(s) ?? s}
		>
			{#if kind === 'index'}
				<!-- index → hollow/dashed swatch -->
				<span
					class="inline-block h-2 w-2 shrink-0 rounded-full border-[1.5px]"
					style="border-color: {colorFor(s)}"
				></span>
			{:else}
				<!-- equity → solid swatch -->
				<span class="inline-block h-2 w-2 shrink-0 rounded-full" style="background: {colorFor(s)}"
				></span>
			{/if}
			<span class="text-(--color-foreground)">{s}</span>
			<span class={cn('text-xs', pctClass(summaryFor(s)))}>{formatPct(summaryFor(s))}</span>
			<button
				type="button"
				aria-label={`Remove ${s}`}
				title={canRemove ? `Remove ${s}` : 'At least one symbol required'}
				disabled={!canRemove}
				onclick={() => onRemove(s)}
				class={cn(
					'inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors',
					'text-(--color-muted-foreground) hover:bg-(--color-accent) hover:text-(--color-foreground)',
					'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'
				)}
			>
				<svg
					viewBox="0 0 20 20"
					class="h-3 w-3"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M5 5l10 10M15 5l-10 10" />
				</svg>
			</button>
		</span>
	{/each}
</div>
