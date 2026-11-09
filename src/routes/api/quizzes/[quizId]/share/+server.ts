import type { RequestHandler } from '@sveltejs/kit';
import { apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';
import { readJson, requireSameOrigin } from '#lib/server/api/request.js';
import { requireAuthenticatedTeacher } from '#lib/server/auth/guard.js';
import { getDb } from '#lib/server/db/client.js';
import { shareTeacherQuiz } from '#lib/server/quizzes/service.js';
import { shareQuizSchema } from '#lib/server/validation/quiz.js';

export const POST: RequestHandler = async (event) => {
	try {
		requireSameOrigin(event);
		const teacher = requireAuthenticatedTeacher(event.locals.teacher);
		const quizId = event.params.quizId ?? '';
		const { isPublic } = await readJson(event, shareQuizSchema);
		const quiz = await shareTeacherQuiz(getDb(event.platform), teacher.id, quizId, isPublic);
		return jsonResponse({ quiz });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
