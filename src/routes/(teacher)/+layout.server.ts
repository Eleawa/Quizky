import type { ServerLoad } from '@sveltejs/kit';
import { requireTeacher } from '#lib/server/auth/guard.js';

export const load: ServerLoad = ({ locals, url }) => {
	return { teacher: requireTeacher(locals.teacher, url) };
};
