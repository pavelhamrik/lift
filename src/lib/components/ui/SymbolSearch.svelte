<script lang="ts">
	import { browser } from '$app/environment';
	import { cn } from '$lib/utils.js';
	import { isValidSymbol } from '$lib/selection.js';
	import {
		buildBrowseList,
		searchLocal,
		mergeResults,
		type SymbolSearchResult
	} from '$lib/symbols.js';
	import { captureEvent } from '$lib/analytics/posthog.js';

	type Source = 'browse' | 'search' | 'exact';
	type Option = { result: SymbolSearchResult; disabled: boolean; exact: boolean; source: Source };
	type Group = { heading: string; options: Option[] };

	type Props = {
		selected: string[];
		disabled?: boolean;
		onAdd: (result: SymbolSearchResult) => void;
	};

	let { selected, disabled = false, onAdd }: Props = $props();

	// The list-query threshold: at/above it we hit the network; below it the
	// bundled local list (and the exact-add action) carry the interaction.
	const MIN_QUERY = 2;
	const DEBOUNCE_MS = 250;
	const isMac = browser && /mac/i.test(navigator.platform);

	const browseGroups = buildBrowseList();

	let query = $state('');
	let open = $state(false);
	let highlight = $state(0);
	let remote = $state<SymbolSearchResult[]>([]);
	let loadingRemote = $state(false);
	let remoteError = $state(false);
	let exactError = $state(false);
	let inputEl: HTMLInputElement | undefined = $state();
	let focused = $state(false);
	let blurTimer: ReturnType<typeof setTimeout> | null = null;

	let searchSeq = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const normalizedQuery = $derived(query.trim().toUpperCase());
	const belowThreshold = $derived(normalizedQuery.length > 0 && normalizedQuery.length < MIN_QUERY);
	const selectedSet = $derived(new Set(selected.map((s) => s.toUpperCase())));

	// The `/` hint chip shows only when the box is idle — empty, unfocused, enabled.
	const showHint = $derived(!focused && query.length === 0 && !disabled);

	// Local matches honour the same 2-char minimum as the remote search: a single
	// letter would surface a handful of bundled hits and then lurch as the (far
	// larger) Yahoo set arrives at the second character — misleading, so we wait.
	const localMatches = $derived(
		normalizedQuery.length >= MIN_QUERY ? searchLocal(normalizedQuery) : []
	);
	const merged = $derived(mergeResults(localMatches, remote));

	function toOption(result: SymbolSearchResult, source: Source): Option {
		return { result, disabled: selectedSet.has(result.symbol.toUpperCase()), exact: false, source };
	}

	// Matches render in a fixed editorial order — Equities first (the usual search
	// target), then ETFs, then Indices — so the grouping stays stable across queries
	// instead of reshuffling as you type. The auto-highlight tracks relevance
	// independently (see `defaultHighlight`), so Enter still adds the strongest match
	// even when its group sits lower.
	const ASSET_GROUP_ORDER: SymbolSearchResult['asset'][] = ['EQUITY', 'ETF', 'INDEX'];
	const ASSET_GROUP_HEADING: Record<SymbolSearchResult['asset'], string> = {
		INDEX: 'Indices',
		ETF: 'ETFs',
		EQUITY: 'Equities'
	};

	// Split relevance-sorted matches into per-type groups, preserving rank within each,
	// and emit them in the fixed ASSET_GROUP_ORDER.
	function groupByAsset(rows: SymbolSearchResult[]): Group[] {
		if (rows.length === 0) return [];
		const buckets = new Map<SymbolSearchResult['asset'], Option[]>();
		for (const r of rows) {
			const opt = toOption(r, 'search');
			const list = buckets.get(r.asset);
			if (list) list.push(opt);
			else buckets.set(r.asset, [opt]);
		}
		const groups: Group[] = [];
		for (const asset of ASSET_GROUP_ORDER) {
			const opts = buckets.get(asset);
			if (opts && opts.length) groups.push({ heading: ASSET_GROUP_HEADING[asset], options: opts });
		}
		return groups;
	}

	const displayGroups = $derived.by<Group[]>(() => {
		if (!normalizedQuery) {
			return browseGroups.map((g) => ({
				heading: g.group,
				options: g.entries.map((e) => toOption(e, 'browse'))
			}));
		}

		const matchGroups: Group[] = groupByAsset(merged);

		// The dedicated exact-symbol action, independent of any auto-highlight: shown
		// whenever the typed token is a valid symbol that isn't already a match row.
		const inMatches = merged.some((m) => m.symbol.toUpperCase() === normalizedQuery);
		let exactGroups: Group[] = [];
		if (isValidSymbol(normalizedQuery) && !inMatches) {
			const placeholder: SymbolSearchResult = {
				symbol: normalizedQuery,
				name: '',
				asset: 'EQUITY',
				kind: 'equity'
			};
			exactGroups = [
				{
					heading: 'Add exact symbol',
					options: [
						{
							result: placeholder,
							disabled: selectedSet.has(normalizedQuery),
							exact: true,
							source: 'exact'
						}
					]
				}
			];
		}

		// Below the 2-char threshold the exact action is primary (first, so plain
		// Enter adds it); at/above it the ranked matches lead and exact sits below.
		return belowThreshold ? [...exactGroups, ...matchGroups] : [...matchGroups, ...exactGroups];
	});

	const flatOptions = $derived(displayGroups.flatMap((g) => g.options));

	// The row to pre-select. Tracks relevance — `merged` is relevance-sorted — rather
	// than the fixed group order, so Enter adds the strongest match even when its type
	// group renders lower (e.g. "s&p" highlights the S&P 500 ETF, not a name-matched
	// equity that sorts into the Equities group above it). When there's no enabled
	// match (browse list, below threshold, or every match already added) it falls back
	// to the first enabled row — the exact-add action, the first browse item, etc.
	function defaultHighlight(): number {
		if (flatOptions.length === 0) return 0;
		for (const m of merged) {
			if (selectedSet.has(m.symbol.toUpperCase())) continue;
			const idx = flatOptions.findIndex(
				(o) => !o.exact && o.result.symbol.toUpperCase() === m.symbol.toUpperCase()
			);
			if (idx !== -1) return idx;
		}
		const fb = flatOptions.findIndex((o) => !o.disabled);
		return fb === -1 ? 0 : fb;
	}

	// Reset the highlight to the default row whenever the option set changes (new
	// query, or remote results arrived). `highlight` is also moved by arrow keys and
	// hover, so it's writable state, not a derived value.
	$effect(() => {
		const count = flatOptions.length;
		highlight = count > 0 ? defaultHighlight() : 0;
	});

	// Debounced, sequence-guarded remote search. Below the threshold we never hit
	// the network — the local list and exact action suffice.
	$effect(() => {
		const q = normalizedQuery;
		searchSeq++;
		const seq = searchSeq;
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		if (q.length < MIN_QUERY) {
			remote = [];
			loadingRemote = false;
			remoteError = false;
			return;
		}
		loadingRemote = true;
		remoteError = false;
		debounceTimer = setTimeout(() => void runSearch(q, seq), DEBOUNCE_MS);
	});

	async function runSearch(q: string, seq: number) {
		try {
			const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
			if (seq !== searchSeq) return;
			if (!r.ok) {
				remote = [];
				remoteError = true;
				loadingRemote = false;
				return;
			}
			const body = (await r.json()) as SymbolSearchResult[];
			if (seq !== searchSeq) return;
			remote = body;
			loadingRemote = false;
			if (mergeResults(searchLocal(q), body).length === 0) captureEvent('search_no_results');
		} catch {
			if (seq !== searchSeq) return;
			remote = [];
			remoteError = true;
			loadingRemote = false;
		}
	}

	function reset() {
		query = '';
		remote = [];
		exactError = false;
		highlight = 0;
	}

	function addResult(result: SymbolSearchResult, source: Source) {
		captureEvent('symbol_added', { symbol: result.symbol, source, asset: result.asset });
		onAdd(result);
		reset();
		// Added — close the dropdown and release focus rather than staying open
		// to add another (standard combobox behavior on commit).
		open = false;
		inputEl?.blur();
	}

	async function resolveExactAndAdd(symbol: string) {
		exactError = false;
		try {
			const r = await fetch(`/api/lookup?symbol=${encodeURIComponent(symbol)}`);
			if (!r.ok) {
				exactError = true;
				return;
			}
			const body = (await r.json()) as SymbolSearchResult;
			addResult(
				{
					symbol: body.symbol,
					name: body.name,
					asset: body.asset,
					kind: body.kind,
					currency: body.currency
				},
				'exact'
			);
		} catch {
			exactError = true;
		}
	}

	function select(opt: Option) {
		if (opt.disabled || disabled) return;
		if (opt.exact) void resolveExactAndAdd(opt.result.symbol);
		else addResult(opt.result, opt.source);
	}

	function move(dir: 1 | -1) {
		const n = flatOptions.length;
		if (n === 0) return;
		let i = highlight;
		for (let step = 0; step < n; step++) {
			i = (i + dir + n) % n;
			if (!flatOptions[i].disabled) {
				highlight = i;
				return;
			}
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			if (!disabled && isValidSymbol(normalizedQuery) && !selectedSet.has(normalizedQuery)) {
				void resolveExactAndAdd(normalizedQuery);
			}
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			open = true;
			move(1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			move(-1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const opt = flatOptions[highlight];
			if (opt) select(opt);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			open = false;
			inputEl?.blur();
		}
	}

	function onFocus() {
		if (blurTimer) {
			clearTimeout(blurTimer);
			blurTimer = null;
		}
		focused = true;
		if (!disabled) open = true;
	}

	function onBlur() {
		focused = false;
		// Defer so a mousedown-driven item click still registers before we close.
		blurTimer = setTimeout(() => {
			open = false;
		}, 120);
	}

	// `/` focuses the search from anywhere — the common search shortcut (GitHub,
	// Slack, YouTube). Ignored while typing in another field so it never swallows
	// a literal slash.
	function isEditableTarget(el: EventTarget | null): boolean {
		if (!(el instanceof HTMLElement)) return false;
		return (
			el.tagName === 'INPUT' ||
			el.tagName === 'TEXTAREA' ||
			el.tagName === 'SELECT' ||
			el.isContentEditable
		);
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
		if (disabled || isEditableTarget(e.target)) return;
		e.preventDefault();
		inputEl?.focus();
	}

	function assetHint(asset: SymbolSearchResult['asset']): string {
		return asset === 'INDEX' ? 'Index' : asset === 'ETF' ? 'ETF' : 'Equity';
	}

	// Stable per-option index for keyboard highlight comparison across groups.
	function optionIndex(group: Group, optionInGroup: number): number {
		let base = 0;
		for (const g of displayGroups) {
			if (g === group) break;
			base += g.options.length;
		}
		return base + optionInGroup;
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="relative w-full min-w-0 sm:w-[28.8rem]">
	<div class="relative flex items-center">
		<svg
			viewBox="0 0 20 20"
			class="pointer-events-none absolute left-3 h-4 w-4 text-(--color-muted-foreground)"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="9" cy="9" r="6" />
			<path d="M14 14l4 4" />
		</svg>
		<input
			bind:this={inputEl}
			bind:value={query}
			type="text"
			role="combobox"
			aria-expanded={open}
			aria-controls="symbol-search-listbox"
			aria-label="Add a symbol"
			autocomplete="off"
			autocapitalize="characters"
			spellcheck="false"
			{disabled}
			placeholder={disabled ? 'Max symbols reached' : 'Search ticker or index…'}
			onkeydown={onKeydown}
			onfocus={onFocus}
			onblur={onBlur}
			class={cn(
				'h-9 w-full rounded-full border pr-9 pl-9 text-sm transition-[color,box-shadow]',
				'bg-(--color-card) text-(--color-card-foreground) placeholder:text-(--color-muted-foreground)',
				'border-(--color-input) hover:border-(--color-muted-foreground)/60',
				'focus-ring',
				'disabled:cursor-not-allowed disabled:opacity-50'
			)}
		/>
		{#if showHint}
			<kbd
				aria-hidden="true"
				class="pointer-events-none absolute right-3 hidden size-[18px] items-center justify-center rounded-sm border border-(--color-border) font-sans text-[11px] leading-none text-(--color-muted-foreground) any-pointer-fine:inline-flex"
				>/</kbd
			>
		{/if}
	</div>

	{#if open && !disabled}
		<div
			id="symbol-search-listbox"
			role="listbox"
			aria-label="Symbol results"
			class={cn(
				'absolute z-50 mt-1 max-h-[min(70vh,420px)] w-full overflow-y-auto',
				'rounded-[var(--radius)] border shadow-md',
				'bg-(--color-popover) text-(--color-popover-foreground)',
				'border-(--color-border) p-1'
			)}
		>
			{#if loadingRemote && merged.length === 0 && displayGroups.length === 0}
				<div class="px-2 py-2 text-xs text-(--color-muted-foreground)">Searching…</div>
			{/if}

			{#each displayGroups as group, gi (group.heading + gi)}
				{#if gi > 0}
					<div class="my-1 h-px bg-(--color-border)"></div>
				{/if}
				<div
					class="px-2 py-1 text-[11px] font-medium tracking-wide text-(--color-muted-foreground) uppercase"
				>
					{group.heading}
				</div>
				{#each group.options as opt, oi (opt.result.symbol + (opt.exact ? ':exact' : ''))}
					{@const idx = optionIndex(group, oi)}
					<button
						type="button"
						role="option"
						aria-selected={highlight === idx}
						disabled={opt.disabled}
						onmousedown={(e) => e.preventDefault()}
						onmouseenter={() => (highlight = idx)}
						onclick={() => select(opt)}
						class={cn(
							'flex w-full cursor-default items-center justify-between gap-2',
							'rounded-[calc(var(--radius)-2px)] px-2 py-1.5 text-left text-sm select-none',
							highlight === idx && 'bg-(--color-muted)',
							'disabled:opacity-40',
							'outline-none'
						)}
					>
						<span class="flex min-w-0 items-center gap-2">
							<span class="shrink-0 font-medium text-(--color-foreground)">{opt.result.symbol}</span
							>
							{#if opt.exact}
								<span class="truncate text-xs text-(--color-muted-foreground)">
									Add exact symbol
								</span>
							{:else if opt.result.name}
								<span class="truncate text-xs text-(--color-muted-foreground)">
									{opt.result.name}
								</span>
							{/if}
						</span>
						<span class="flex shrink-0 items-center gap-1.5">
							{#if opt.disabled}
								<svg
									viewBox="0 0 20 20"
									class="h-3.5 w-3.5 text-(--color-muted-foreground)"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M4 10l4 4 8-8" />
								</svg>
							{:else}
								<span class="text-[11px] text-(--color-muted-foreground)">
									{assetHint(opt.result.asset)}{opt.result.exchange
										? ` · ${opt.result.exchange}`
										: ''}
								</span>
							{/if}
						</span>
					</button>
				{/each}
			{/each}

			{#if exactError}
				<div class="px-2 py-2 text-xs text-(--color-destructive)">Symbol not found.</div>
			{:else if remoteError && merged.length === 0}
				<div class="px-2 py-2 text-xs text-(--color-muted-foreground)">
					Couldn’t reach search. Try the exact symbol.
				</div>
			{:else if normalizedQuery && displayGroups.length === 0 && !loadingRemote}
				<div class="px-2 py-2 text-xs text-(--color-muted-foreground)">No matches.</div>
			{/if}

			{#if normalizedQuery && isValidSymbol(normalizedQuery)}
				<div class="mt-1 border-t border-(--color-border) px-2 pt-1.5 pb-1">
					<span class="text-[11px] text-(--color-muted-foreground)">
						Press {isMac ? '⌘' : 'Ctrl'}+Enter to add “{normalizedQuery}” exactly
					</span>
				</div>
			{/if}
		</div>
	{/if}
</div>
