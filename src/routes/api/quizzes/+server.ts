import type { RequestHandler } from '@sveltejs/kit';
import { apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';
import { readJson, requireSameOrigin } from '#lib/server/api/request.js';
import { requireAuthenticatedTeacher } from '#lib/server/auth/guard.js';
import { getDb } from '#lib/server/db/client.js';
import { createTeacherQuiz, listTeacherQuizzes } from '#lib/server/quizzes/service.js';
import { createQuizSchema } from '#lib/server/validation/quiz.js';

export const GET: RequestHandler = async (event) => {
	try {
		const teacher = requireAuthenticatedTeacher(event.locals.teacher);
		const quizzes = await listTeacherQuizzes(getDb(event.platform), teacher.id);
		return jsonResponse({ quizzes });
	} catch (error) {
		return apiErrorResponse(error);
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		requireSameOrigin(event);
		const teacher = requireAuthenticatedTeacher(event.locals.teacher);
		const input = await readJson(event, createQuizSchema);
		const quiz = await createTeacherQuiz(getDb(event.platform), teacher.id, input);
		return jsonResponse({ quiz }, { status: 201 });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
