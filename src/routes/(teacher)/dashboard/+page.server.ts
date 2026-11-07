import type { ServerLoad } from '@sveltejs/kit';
import { requireTeacher } from '#lib/server/auth/guard.js';
import { getDb } from '#lib/server/db/client.js';
import { listTeacherQuizzes } from '#lib/server/quizzes/service.js';
import { listTeacherRecentSessions } from '#lib/server/sessions/service.js';

export const load: ServerLoad = async ({ locals, platform, url }) => {
	const teacher = requireTeacher(locals.teacher, url);
	const db = getDb(platform);
	const [quizzes, recentSessions] = await Promise.all([
		listTeacherQuizzes(db, teacher.id),
		listTeacherRecentSessions(db, teacher.id, 10)
	]);
	return { teacher, quizzes, recentSessions };
};
