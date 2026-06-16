<script lang="ts">
	import { resolve } from '$app/paths';
	import { cn } from '$lib/utils.js';
</script>

<svelte:head>
	<title>About · Lift</title>
	<meta
		name="description"
		content="Why Lift exists: compare stocks against investable market alternatives."
	/>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
	<header class="mb-10 flex items-center justify-between gap-4">
		<h1 class="text-2xl font-semibold tracking-tight">About Lift</h1>
		<a
			href={resolve('/')}
			class={cn(
				'inline-flex h-9 items-center justify-center rounded-full border px-4 text-sm font-medium',
				'bg-(--color-card) text-(--color-card-foreground) hover:bg-(--color-muted)',
				'border-(--color-input) transition-colors focus:border-(--color-ring) focus:outline-none'
			)}
		>
			← Back
		</a>
	</header>

	<div class="space-y-8 text-sm leading-relaxed">
		<section>
			<div class="space-y-3">
				<p class="text-base font-medium text-(--color-foreground)">
					A stock can go up and still be the wrong bet.
				</p>
				<p>If you take on single-stock risk, making money is only part of the story.</p>
				<p>
					The better question is whether the bet rewarded you more than the simple alternative:
					buying an S&amp;P 500 fund like VOO or SPY and letting the market work.
				</p>
			</div>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">Why we built it</h2>
			<div class="space-y-3">
				<p>
					We make that comparison easy to see. Put a stock and an investable market fund on the same
					normalized chart, and risk and payoff become visible together.
				</p>
				<p>
					The point is not to win every argument with the market. It is to look clearly at the one
					you are actually having. Beating the market consistently is hard. Seeing that plainly can
					make passive investing more compelling, and make the active bets you do take more honest.
				</p>
			</div>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">No built-in opinion</h2>
			<div class="space-y-3">
				<p>We do not have an opinion about what you should buy.</p>
				<p>
					If you already know what you are doing, use it plainly: add your favorite tickers, choose
					the comparison that matters to you, and see how they did. The tool is just there to make
					the relationship visible.
				</p>
			</div>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">Lift is deliberately narrow</h2>
			<p>
				This is a small, focused project, built because we wanted this comparison to be easier to
				explore and share. It is open to improvement, correction, and better ideas.
			</p>
			<p class="mt-3">
				Feedback is welcome at
				<a
					href="mailto:hey@grubs.cc"
					class="underline underline-offset-2 hover:text-(--color-primary)">hey@grubs.cc</a
				>.
			</p>
			<p class="mt-3">Have fun charting.</p>
		</section>
	</div>
</div>
