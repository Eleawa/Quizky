import type { ServerLoad } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/client.js';
import { lookupSessionByJoinCode } from '#lib/server/sessions/service.js';
import { normalizeJoinCode } from '#lib/server/validation/session.js';

export const load: ServerLoad = async ({ locals, params, platform }) => {
	const code = normalizeJoinCode(params.code ?? '');

	try {
		const session = await lookupSessionByJoinCode(getDb(platform), code);
		return {
			teacher: locals.teacher,
			code: session.joinCode,
			session
		};
	} catch {
		return {
			teacher: locals.teacher,
			code,
			session: null
		};
	}
};
