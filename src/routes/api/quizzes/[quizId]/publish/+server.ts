import type { RequestHandler } from '@sveltejs/kit';
import { apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';
import { requireSameOrigin } from '#lib/server/api/request.js';
import { requireAuthenticatedTeacher } from '#lib/server/auth/guard.js';
import { getDb } from '#lib/server/db/client.js';
import { publishTeacherQuiz } from '#lib/server/quizzes/service.js';

export const POST: RequestHandler = async (event) => {
	try {
		requireSameOrigin(event);
		const teacher = requireAuthenticatedTeacher(event.locals.teacher);
		const quizId = event.params.quizId ?? '';
		const quiz = await publishTeacherQuiz(getDb(event.platform), teacher.id, quizId);
		return jsonResponse({ quiz });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
