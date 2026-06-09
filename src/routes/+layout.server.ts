import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession }, cookies }) => {
	const { session, user } = await safeGetSession();
	// cookies are forwarded so the client-side createServerClient (during SSR)
	// can read the same auth state without a second round-trip.
	return { session, user, cookies: cookies.getAll() };
};
