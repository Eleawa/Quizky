import { redirect } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { safeNextPath } from '#lib/server/validation/auth.js';

export const load: ServerLoad = ({ locals, url }) => {
	const next = safeNextPath(url.searchParams.get('next'));
	if (locals.teacher) {
		throw redirect(303, next);
	}
	return { next };
};
