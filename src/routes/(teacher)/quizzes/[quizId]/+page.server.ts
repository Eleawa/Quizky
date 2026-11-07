import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { ApiError } from '#lib/server/api/errors.js';
import { requireTeacher } from '#lib/server/auth/guard.js';
import { getDb } from '#lib/server/db/client.js';
import { getTeacherQuiz } from '#lib/server/quizzes/service.js';

export const load: ServerLoad = async ({ locals, params, platform, url }) => {
	const teacher = requireTeacher(locals.teacher, url);
	const quizId = params.quizId ?? '';

	try {
		const quiz = await getTeacherQuiz(getDb(platform), teacher.id, quizId);
		return { teacher, quiz };
	} catch (caught) {
		if (caught instanceof ApiError && caught.status === 404) {
			throw error(404, 'Quiz not found.');
		}
		throw caught;
	}
};
