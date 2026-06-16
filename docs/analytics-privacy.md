# Analytics privacy checklist

Lift sends cookieless PostHog pageviews by default under legitimate interest;
visitors can opt out at any time via **Privacy settings**. Because nothing is
stored on or read from the device, ePrivacy Art. 5(3) consent is not triggered.
The client is limited to manual, cookieless pageviews and rejects every other
event in `before_send`.

## Required PostHog settings

1. Use a **PostHog Cloud EU** project. The client host should remain
   `https://eu.i.posthog.com`.
2. In **Project settings → Web analytics**, enable **Cookieless server hash mode**.
3. In **Organization settings → General** and **Project settings → General**,
   disable IP data capture. Check both because the project setting can override the
   organization default.
4. Generate and sign the PostHog DPA at `https://app.posthog.com/legal`.
5. Limit project access to the people who need it and require MFA.
6. Set the shortest useful event-retention period (ninety days is a reasonable
   default). Keep the privacy policy's retention wording consistent with whatever
   you configure.
7. Do not enable autocapture, session replay, surveys, experiments, feature flags,
   exception capture, destinations, or account identification without revisiting
   this opt-out model and the privacy policy. Anything that stores an identifier
   on the device (cookies, persistent localStorage) would re-trigger ePrivacy
   consent and require switching back to an opt-in banner.

## Release verification

Test in a fresh private browser window with developer tools open:

1. On first load (no stored choice), only `$pageview` requests should go to a
   PostHog host — and no PostHog cookie or analytics identifier in storage.
2. Opting out through the notice or **Privacy settings** must stop further
   PostHog requests immediately.
3. After opting out and reloading, no PostHog request should fire.
4. Re-enabling through **Privacy settings** should resume `$pageview` events only.
5. Event URLs and referrers must not contain ticker query parameters.

Keep the consent text, consent-version change history, this checklist, and the
signed DPA as compliance records.
