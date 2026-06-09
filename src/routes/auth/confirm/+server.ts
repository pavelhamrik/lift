import { redirect, type RequestHandler } from '@sveltejs/kit';
import type { EmailOtpType } from '@supabase/supabase-js';

// Magic-link landing route. Supabase emails a link to
//   /auth/confirm?token_hash=...&type=email&next=/
// (configured in the Supabase email template). We verify the token to set the
// session cookie, then bounce to `next` (defaulting to the home page).
export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const token_hash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;
	const nextParam = url.searchParams.get('next') ?? '/';
	// Only allow same-site relative redirects.
	const next = nextParam.startsWith('/') ? nextParam : '/';

	if (token_hash && type) {
		const { error } = await supabase.auth.verifyOtp({ token_hash, type });
		if (!error) {
			throw redirect(303, next);
		}
	}

	throw redirect(303, '/?auth=error');
};
