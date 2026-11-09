import type { RequestHandler } from '@sveltejs/kit';
import { apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';
import { requireAuthenticatedTeacher } from '#lib/server/auth/guard.js';
import { getDb } from '#lib/server/db/client.js';
import { listLibraryQuizzes } from '#lib/server/quizzes/service.js';

export const GET: RequestHandler = async (event) => {
	try {
		requireAuthenticatedTeacher(event.locals.teacher);
		const search = event.url.searchParams.get('search') ?? undefined;
		const quizzes = await listLibraryQuizzes(getDb(event.platform), search);
		return jsonResponse({ quizzes });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
