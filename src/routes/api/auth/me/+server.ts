import type { RequestHandler } from '@sveltejs/kit';
import { ApiError, apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		if (!locals.teacher) {
			throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
		}
		return jsonResponse({ teacher: locals.teacher });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
