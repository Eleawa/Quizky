import { redirect } from '@sveltejs/kit';
import { ApiError } from '../api/errors.js';
import type { PublicTeacher } from './types.js';

export function requireTeacher(teacher: PublicTeacher | null, url: URL): PublicTeacher {
	if (!teacher) {
		const next = `${url.pathname}${url.search}`;
		throw redirect(303, `/login?next=${encodeURIComponent(next)}`);
	}
	return teacher;
}

export function requireAuthenticatedTeacher(teacher: PublicTeacher | null): PublicTeacher {
	if (!teacher) {
		throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
	}
	return teacher;
}
