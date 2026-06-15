<script lang="ts">
	import { resolve } from '$app/paths';
	import { cn } from '$lib/utils.js';
</script>

<svelte:head>
	<title>Privacy · Lift</title>
	<meta name="description" content="Privacy policy for Lift." />
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
	<header class="mb-10 flex items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Privacy policy</h1>
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
			<h2 class="mb-2 text-lg font-semibold tracking-tight">1. Who is responsible</h2>
			<p>
				Lift is responsible for the personal data described in this policy. Contact
				<a
					href="mailto:privacy@grubs.cc"
					class="underline underline-offset-2 hover:text-(--color-primary)"
				>
					privacy@grubs.cc
				</a>
				for privacy questions or requests.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">2. Data Lift handles</h2>
			<ul class="list-disc space-y-2 pl-5">
				<li>
					<strong>Account data:</strong> your email address, Supabase user ID, authentication records,
					and session cookies when you request a magic link or sign in.
				</li>
				<li>
					<strong>Saved content:</strong> names and ticker/range selections you choose to save to your
					account.
				</li>
				<li>
					<strong>Requests and security data:</strong> IP address, browser and device information, request
					URLs, timestamps, and errors processed by Lift and its hosting infrastructure for delivery,
					rate limiting, security, and debugging.
				</li>
				<li>
					<strong>Usage measurement (anonymous), unless you opt out:</strong> one cookieless pageview
					event when a page loads or you navigate within Lift. Lift explicitly sends the page origin and
					path without query parameters. PostHog may attach standard technical context such as the timestamp,
					referring domain, browser, operating system, device type, language, and screen size. In cookieless
					server hash mode, PostHog transiently uses the IP address, user agent, hostname, and a daily
					salt to count visitors, then strips the IP address before event enrichment and storage.
				</li>
				<li>
					<strong>Local preferences:</strong> theme, current chart selections, and your analytics choice
					stored only in your browser’s local storage unless you explicitly save a comparison to your
					account.
				</li>
			</ul>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">3. Why data is used</h2>
			<ul class="list-disc space-y-2 pl-5">
				<li>Provide sign-in and saved comparisons at your request.</li>
				<li>Deliver, secure, rate-limit, maintain, and troubleshoot the service.</li>
				<li>Understand aggregate page usage so Lift can be improved.</li>
				<li>Comply with law and respond to valid legal requests.</li>
			</ul>
			<p class="mt-3">
				Where European data-protection law applies, cookieless analytics relies on Lift’s legitimate
				interest in understanding aggregate usage. Because no information is stored on or read from
				your device, it runs without a consent banner, and you can object — opt out — at any time
				using <strong>Privacy settings</strong>. Sign-in and saved comparisons are processed to
				provide the service you request. Service delivery, security, rate limiting, and
				troubleshooting also rely on legitimate interests, and some processing may be required by
				law. Lift does not use personal data for targeted advertising.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">4. Cookies and browser storage</h2>
			<p>
				If you do not sign in, Lift does not set its own cookies. Theme and chart preferences use
				your browser’s local storage, which is separate from cookies. If you sign in, Supabase sets
				strictly necessary authentication cookies to maintain your session. Hosting and security
				providers may also set short-lived cookies when needed to protect the service.
			</p>
			<p class="mt-3">
				Lift’s analytics run in cookieless mode. PostHog does not store analytics identifiers in
				cookies or local/session storage. Autocapture, page-leave capture, session recording,
				exception capture, surveys, experiments, feature flags, and account identification are
				disabled. Lift does not send clicks, form contents, input values, saved comparisons, account
				IDs, email addresses, or ticker query parameters to PostHog. If you opt out, Lift stops
				sending pageviews.
			</p>
			<p class="mt-3">
				Lift stores your analytics choice, the policy version, and the time of your choice in local
				storage so it does not repeatedly ask you and so it can honor an opt-out. This record is not
				sent to Lift or PostHog. You can opt out, or opt back in, at any time using <strong
					>Privacy settings</strong
				>. You can also clear cookies and local storage through your browser; doing so will sign you
				out and reset local preferences.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">5. Service providers</h2>
			<p>Lift relies on the following providers to operate:</p>
			<ul class="mt-3 list-disc space-y-2 pl-5">
				<li>
					<strong>Cloudflare</strong> for hosting, delivery, security, logs, and rate limiting.
				</li>
				<li>
					<strong>Supabase</strong> for email authentication, sessions, and saved comparisons.
				</li>
				<li><strong>PostHog EU</strong> for anonymous, cookieless pageview measurement.</li>
				<li><strong>Yahoo Finance</strong> as the market-data source.</li>
			</ul>
			<p class="mt-3">
				Market-data requests are made by Lift’s server. Yahoo receives requested ticker symbols and
				the server request, not your Lift email address or Supabase account ID. Providers may
				process data under their own privacy notices and contractual obligations.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">6. Sharing and sales</h2>
			<p>
				Lift does not sell personal data and does not share it for cross-context behavioral
				advertising. Data is disclosed only to the providers above, when you direct Lift to do so,
				when required by law, or when reasonably necessary to protect users, the service, or legal
				rights.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">7. Retention</h2>
			<p>
				Account data and saved comparisons are kept while your account is active or until you ask
				for deletion, subject to limited backups and legal obligations. Operational, security, and
				analytics data is kept only as long as reasonably needed for those purposes, using the
				retention controls of the relevant provider. Browser-local preferences remain until you
				clear them.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">8. International processing</h2>
			<p>
				Providers may process data outside your country. Where required, transfers are supported by
				recognized safeguards such as adequacy decisions or standard contractual clauses.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">9. Your choices and rights</h2>
			<p>
				You can use Lift without an account, delete individual saved comparisons in the app, sign
				out, opt out of analytics using <strong>Privacy settings</strong>, and clear local browser
				data at any time. Opting out stops future analytics but does not affect processing that
				occurred before you opted out. Depending on where you live, you may also have rights to
				access, correct, delete, restrict, or receive your personal data, or object to certain
				processing. You may complain to your local data-protection authority.
			</p>
			<p class="mt-3">
				Email
				<a
					href="mailto:privacy@grubs.cc"
					class="underline underline-offset-2 hover:text-(--color-primary)"
				>
					privacy@grubs.cc
				</a>
				to exercise a right or request account deletion. Identity may need to be verified before a request
				is completed.
			</p>
		</section>

		<section>
			<h2 class="mb-2 text-lg font-semibold tracking-tight">10. Children and changes</h2>
			<p>
				Lift is not directed to children under 16, and account features should not be used by them.
				This policy may be updated when the service or legal requirements change. The effective date
				above will show the latest revision.
			</p>
		</section>
	</div>

	<footer class="mt-10 flex gap-4 border-t pt-6 text-sm text-(--color-muted-foreground)">
		<a href={resolve('/terms')} class="underline underline-offset-2 hover:text-(--color-foreground)"
			>Terms</a
		>
		<a href={resolve('/docs')} class="underline underline-offset-2 hover:text-(--color-foreground)"
			>Docs</a
		>
	</footer>
</div>
