import type { RequestHandler } from '@sveltejs/kit';
import { ApiError, apiErrorResponse } from '#lib/server/api/errors.js';
import { requireSameOrigin } from '#lib/server/api/request.js';
import { logoutTeacher } from '#lib/server/auth/service.js';
import { SESSION_COOKIE, clearSessionCookie } from '#lib/server/auth/session.js';
import { getDb } from '#lib/server/db/client.js';

export const POST: RequestHandler = async (event) => {
	try {
		requireSameOrigin(event);
	} catch (error) {
		return apiErrorResponse(error);
	}

	try {
		const token = event.cookies.get(SESSION_COOKIE);
		if (token) {
			await logoutTeacher(getDb(event.platform), token);
		}
		clearSessionCookie(event);
		return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		clearSessionCookie(event);
		console.error('Failed to log out teacher', error);
		return apiErrorResponse(new ApiError(503, 'auth_unavailable', 'Sign-out failed. Try again.'));
	}
};
