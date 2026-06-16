<script lang="ts">
	import { resolve } from '$app/paths';
	import { cn } from '$lib/utils.js';
</script>

<svelte:head>
	<title>Terms · Lift</title>
	<meta name="description" content="Terms of use for Lift." />
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
	<header class="mb-10 flex items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Terms of use</h1>
			<p class="mt-1 text-sm text-(--color-muted-foreground)">Effective June 13, 2026</p>
		</div>
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
			<h2 class="mb-2 text-lg font-semibold tracking-tight">1. About Lift</h2>
			<p>
				Lift is a free informational tool. By using the hosted Lift service, you agree to these
				terms. If you do not agree, do not use the service.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">2. Not financial advice</h2>
			<p>
				Lift does not provide investment, financial, tax, legal, or other professional advice.
				Charts and calculations are for general information only. They may be delayed, incomplete,
				inaccurate, or based on assumptions that do not fit your circumstances. Do your own research
				and consult a qualified professional before making financial decisions.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">3. No service guarantee</h2>
			<p>
				The service is provided “as is” and “as available.” To the fullest extent allowed by law,
				Lift makes no warranties about accuracy, availability, fitness for a particular purpose,
				security, or uninterrupted operation. Features, data sources, accounts, and saved
				comparisons may change, fail, or be discontinued at any time. No support or data-recovery
				commitment is made.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">4. Third-party data and services</h2>
			<p>
				Market data and parts of the service depend on third parties, including Yahoo Finance,
				Cloudflare, Supabase, PostHog, and TradingView Lightweight Charts. Lift does not control or
				guarantee third-party content or services. Their own terms and privacy practices may apply.
				Market data remains subject to the rights and restrictions of its providers.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">5. Acceptable use</h2>
			<p>
				Use Lift lawfully and through its ordinary interface. Do not disrupt the service, bypass
				rate limits or security controls, probe for vulnerabilities, submit malicious content, or
				use automated means to scrape, bulk-download, resell, or create a substitute market-data
				service. Lift may restrict or block access to protect the service or third parties.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">6. Accounts and saved views</h2>
			<p>
				Sign-in is optional. If you use it, you are responsible for access to your email account and
				for activity under your session. Saved comparisons are a convenience, not a backup service.
				Lift may suspend accounts or remove stored data where reasonably necessary for security,
				abuse prevention, legal compliance, or discontinuation of the feature.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">7. Code and other rights</h2>
			<p>
				Lift’s source code is separately offered under the MIT License in its source repository.
				That license does not grant rights to the hosted service, the Lift name or branding,
				third-party software, or market data. No other rights are granted except as needed to use
				the service under these terms.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">8. Limitation of liability</h2>
			<p>
				To the fullest extent allowed by law, Lift and its operator will not be liable for indirect,
				incidental, special, consequential, or punitive damages; loss of profits, data, opportunity,
				or goodwill; investment losses; or decisions made using Lift. Total liability arising from
				the hosted service will not exceed the greater of EUR 50 or the amount you paid for the
				service in the preceding 12 months.
			</p>
			<p class="mt-3">
				Nothing in these terms excludes liability or consumer rights that cannot legally be excluded
				or limited.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">9. Changes and contact</h2>
			<p>
				These terms may be updated when the service or legal requirements change. The effective date
				above will be revised. Continued use after an update means you accept the revised terms.
				Questions may be sent to
				<a
					href="mailto:hey@grubs.cc"
					class="underline underline-offset-2 hover:text-(--color-primary)"
				>
					hey@grubs.cc
				</a>.
			</p>
		</section>
	</div>
</div>
