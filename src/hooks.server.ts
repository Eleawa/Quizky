import type { Handle } from '@sveltejs/kit/hooks';
import { getDb } from '#lib/server/db/client.js';
import { getTeacherBySessionToken } from '#lib/server/auth/service.js';
import { SESSION_COOKIE, clearSessionCookie } from '#lib/server/auth/session.js';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.teacher = null;

	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		try {
			const teacher = await getTeacherBySessionToken(getDb(event.platform), token);
			if (teacher) {
				event.locals.teacher = teacher;
			} else {
				clearSessionCookie(event);
			}
		} catch (error) {
			console.error('Failed to resolve teacher session', error);
		}
	}

	return resolve(event);
};
