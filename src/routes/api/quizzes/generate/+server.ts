import type { RequestHandler } from '@sveltejs/kit';
import { apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';
import { readJson, requireSameOrigin } from '#lib/server/api/request.js';
import { requireAuthenticatedTeacher } from '#lib/server/auth/guard.js';
import { generateQuestionsWithAi } from '#lib/server/quizzes/ai-generator.js';
import { generateQuizQuestionsSchema } from '#lib/server/validation/quiz.js';

export const POST: RequestHandler = async (event) => {
	try {
		requireSameOrigin(event);
		requireAuthenticatedTeacher(event.locals.teacher);
		const input = await readJson(event, generateQuizQuestionsSchema);
		const questions = await generateQuestionsWithAi(event.platform, input);
		return jsonResponse({ questions });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
