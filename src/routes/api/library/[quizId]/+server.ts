import type { RequestHandler } from '@sveltejs/kit';
import { apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';
import { requireAuthenticatedTeacher } from '#lib/server/auth/guard.js';
import { getDb } from '#lib/server/db/client.js';
import { getLibraryQuiz } from '#lib/server/quizzes/service.js';

export const GET: RequestHandler = async (event) => {
	try {
		requireAuthenticatedTeacher(event.locals.teacher);
		const quizId = event.params.quizId ?? '';
		const quiz = await getLibraryQuiz(getDb(event.platform), quizId);
		return jsonResponse({ quiz });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
