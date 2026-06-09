<script lang="ts">
	import { Popover } from 'bits-ui';
	import type { SupabaseClient, User } from '@supabase/supabase-js';
	import type { StoredSelection } from '$lib/selection.js';
	import { cn } from '$lib/utils.js';

	type SavedRow = {
		id: string;
		name: string;
		selection: StoredSelection;
		updated_at: string;
	};

	type Props = {
		supabase: SupabaseClient;
		user: User | null;
		selection: StoredSelection;
		onLoad: (selection: StoredSelection) => void;
	};

	let { supabase, user, selection, onLoad }: Props = $props();

	let open = $state(false);

	// Signed-out: magic-link request
	let email = $state('');
	let sending = $state(false);
	let sent = $state(false);
	let authError = $state<string | null>(null);

	// Signed-in: save current view
	let saveName = $state('');
	let saving = $state(false);
	let saveError = $state<string | null>(null);

	// Signed-in: saved list
	let saved = $state<SavedRow[]>([]);
	let loadingList = $state(false);
	let listError = $state<string | null>(null);

	function defaultName(): string {
		return selection.stocks.join(', ') || 'Comparison';
	}

	async function sendMagicLink() {
		const value = email.trim();
		if (!value) return;
		sending = true;
		authError = null;
		const { error } = await supabase.auth.signInWithOtp({
			email: value,
			options: { emailRedirectTo: `${window.location.origin}/auth/confirm` }
		});
		sending = false;
		if (error) {
			authError = error.message;
			return;
		}
		sent = true;
	}

	async function loadList() {
		if (!user) return;
		loadingList = true;
		listError = null;
		const { data, error } = await supabase
			.from('saved_comparisons')
			.select('id,name,selection,updated_at')
			.order('updated_at', { ascending: false });
		loadingList = false;
		if (error) {
			listError = error.message;
			return;
		}
		saved = (data ?? []) as SavedRow[];
	}

	async function saveCurrent() {
		if (!user) return;
		const name = saveName.trim() || defaultName();
		saving = true;
		saveError = null;
		const { error } = await supabase
			.from('saved_comparisons')
			.insert({ user_id: user.id, name, selection });
		saving = false;
		if (error) {
			saveError = error.message;
			return;
		}
		saveName = '';
		await loadList();
	}

	async function remove(id: string) {
		const { error } = await supabase.from('saved_comparisons').delete().eq('id', id);
		if (!error) saved = saved.filter((r) => r.id !== id);
	}

	function applySaved(row: SavedRow) {
		onLoad(row.selection);
		open = false;
	}

	async function signOut() {
		await supabase.auth.signOut();
		open = false;
	}

	// Refresh the saved list each time the popover opens while signed in.
	$effect(() => {
		if (open && user) void loadList();
	});
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		aria-label={user ? 'Saved comparisons' : 'Sign in to save'}
		title={user ? 'Saved comparisons' : 'Sign in to save'}
		class={cn(
			'inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-medium',
			'bg-(--color-card) text-(--color-card-foreground) hover:bg-(--color-muted)',
			'border-(--color-input) transition-colors',
			'focus:border-(--color-ring) focus:outline-none',
			'data-[state=open]:border-(--color-ring)'
		)}
	>
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
			<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
		</svg>
		{user ? 'Saved' : 'Save'}
	</Popover.Trigger>

	<Popover.Portal>
		<Popover.Content
			sideOffset={6}
			align="end"
			class={cn(
				'z-50 w-[20rem] max-h-[min(80vh,30rem)] overflow-y-auto',
				'rounded-[var(--radius)] border shadow-md outline-none',
				'bg-(--color-popover) text-(--color-popover-foreground)',
				'border-(--color-border) p-3'
			)}
		>
			{#if !user}
				{#if sent}
					<div class="space-y-1.5">
						<div class="text-sm font-medium">Check your inbox</div>
						<p class="text-xs text-(--color-muted-foreground)">
							We sent a sign-in link to <span class="text-(--color-foreground)">{email}</span>.
							Open it on this device to finish signing in.
						</p>
					</div>
				{:else}
					<div class="space-y-2.5">
						<div class="space-y-1">
							<div class="text-sm font-medium">Save your comparisons</div>
							<p class="text-xs text-(--color-muted-foreground)">
								Sign in with a magic link to save views and revisit them later. No password.
							</p>
						</div>
						<form
							class="flex flex-col gap-2"
							onsubmit={(e) => {
								e.preventDefault();
								void sendMagicLink();
							}}
						>
							<input
								type="email"
								bind:value={email}
								required
								placeholder="you@email.com"
								autocomplete="email"
								class={cn(
									'h-9 w-full rounded-[calc(var(--radius)-2px)] border px-3 text-sm',
									'bg-(--color-card) text-(--color-card-foreground)',
									'placeholder:text-(--color-muted-foreground)',
									'border-(--color-input) focus:border-(--color-ring) focus:outline-none'
								)}
							/>
							{#if authError}
								<p class="text-xs text-(--color-destructive)">{authError}</p>
							{/if}
							<button
								type="submit"
								disabled={sending || !email.trim()}
								class={cn(
									'inline-flex h-9 items-center justify-center rounded-full border px-4 text-sm font-medium',
									'bg-(--color-foreground) text-(--color-background) hover:opacity-90',
									'border-transparent transition-opacity',
									'disabled:opacity-50 disabled:cursor-not-allowed'
								)}
							>
								{sending ? 'Sending…' : 'Send magic link'}
							</button>
						</form>
					</div>
				{/if}
			{:else}
				<div class="space-y-3">
					<div class="space-y-2">
						<div class="text-sm font-medium">Save current view</div>
						<form
							class="flex items-center gap-2"
							onsubmit={(e) => {
								e.preventDefault();
								void saveCurrent();
							}}
						>
							<input
								type="text"
								bind:value={saveName}
								placeholder={defaultName()}
								class={cn(
									'h-8 min-w-0 flex-1 rounded-[calc(var(--radius)-2px)] border px-2.5 text-sm',
									'bg-(--color-card) text-(--color-card-foreground)',
									'placeholder:text-(--color-muted-foreground)',
									'border-(--color-input) focus:border-(--color-ring) focus:outline-none'
								)}
							/>
							<button
								type="submit"
								disabled={saving}
								class={cn(
									'inline-flex h-8 shrink-0 items-center justify-center rounded-full border px-3 text-xs font-medium',
									'bg-(--color-foreground) text-(--color-background) hover:opacity-90',
									'border-transparent transition-opacity disabled:opacity-50'
								)}
							>
								{saving ? 'Saving…' : 'Save'}
							</button>
						</form>
						{#if saveError}
							<p class="text-xs text-(--color-destructive)">{saveError}</p>
						{/if}
					</div>

					<div class="h-px bg-(--color-border)"></div>

					<div class="space-y-1.5">
						<div class="text-[11px] font-medium tracking-wide text-(--color-muted-foreground) uppercase">
							Saved
						</div>
						{#if loadingList}
							<p class="text-xs text-(--color-muted-foreground)">Loading…</p>
						{:else if listError}
							<p class="text-xs text-(--color-destructive)">{listError}</p>
						{:else if saved.length === 0}
							<p class="text-xs text-(--color-muted-foreground)">
								Nothing saved yet. Save the current view above.
							</p>
						{:else}
							<ul class="flex flex-col gap-0.5">
								{#each saved as row (row.id)}
									<li class="flex items-center gap-1">
										<button
											type="button"
											onclick={() => applySaved(row)}
											class={cn(
												'min-w-0 flex-1 truncate rounded-[calc(var(--radius)-2px)] px-2 py-1.5 text-left text-sm',
												'hover:bg-(--color-muted) focus:bg-(--color-muted) focus:outline-none'
											)}
										>
											<span class="truncate">{row.name}</span>
											<span class="ml-1.5 text-[11px] text-(--color-muted-foreground)">
												{row.selection.stocks?.join(', ')}
											</span>
										</button>
										<button
											type="button"
											aria-label={`Delete ${row.name}`}
											title="Delete"
											onclick={() => void remove(row.id)}
											class={cn(
												'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
												'text-(--color-muted-foreground) hover:bg-(--color-accent) hover:text-(--color-foreground)'
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
												<path d="M5 5l10 10M15 5l-10 10" />
											</svg>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>

					<div class="h-px bg-(--color-border)"></div>

					<div class="flex items-center justify-between gap-2">
						<span class="truncate text-xs text-(--color-muted-foreground)" title={user.email}>
							{user.email}
						</span>
						<button
							type="button"
							onclick={() => void signOut()}
							class={cn(
								'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
								'text-(--color-muted-foreground) hover:bg-(--color-accent) hover:text-(--color-foreground)'
							)}
						>
							Sign out
						</button>
					</div>
				</div>
			{/if}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
