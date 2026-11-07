import type { RequestHandler } from '@sveltejs/kit';
import { apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';
import { readJson, requireSameOrigin } from '#lib/server/api/request.js';
import { requireAuthenticatedTeacher } from '#lib/server/auth/guard.js';
import { getDb } from '#lib/server/db/client.js';
import {
	deleteTeacherQuiz,
	getTeacherQuiz,
	updateTeacherQuiz
} from '#lib/server/quizzes/service.js';
import { updateQuizSchema } from '#lib/server/validation/quiz.js';

export const GET: RequestHandler = async (event) => {
	try {
		const teacher = requireAuthenticatedTeacher(event.locals.teacher);
		const quizId = event.params.quizId ?? '';
		const quiz = await getTeacherQuiz(getDb(event.platform), teacher.id, quizId);
		return jsonResponse({ quiz });
	} catch (error) {
		return apiErrorResponse(error);
	}
};

export const PUT: RequestHandler = async (event) => {
	try {
		requireSameOrigin(event);
		const teacher = requireAuthenticatedTeacher(event.locals.teacher);
		const quizId = event.params.quizId ?? '';
		const input = await readJson(event, updateQuizSchema);
		const quiz = await updateTeacherQuiz(getDb(event.platform), teacher.id, quizId, input);
		return jsonResponse({ quiz });
	} catch (error) {
		return apiErrorResponse(error);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		requireSameOrigin(event);
		const teacher = requireAuthenticatedTeacher(event.locals.teacher);
		const quizId = event.params.quizId ?? '';
		await deleteTeacherQuiz(getDb(event.platform), teacher.id, quizId);
		return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
