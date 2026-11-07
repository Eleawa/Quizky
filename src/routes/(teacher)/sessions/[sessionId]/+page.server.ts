import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { ApiError } from '#lib/server/api/errors.js';
import { requireTeacher } from '#lib/server/auth/guard.js';
import { getDb } from '#lib/server/db/client.js';
import { createRemoteSessionRoomClient } from '#lib/server/sessions/room-client.js';
import { getTeacherSessionLobby } from '#lib/server/sessions/service.js';

export const load: ServerLoad = async ({ locals, params, platform, url }) => {
	const teacher = requireTeacher(locals.teacher, url);
	const sessionId = params.sessionId ?? '';

	try {
		const snapshot = await getTeacherSessionLobby(
			getDb(platform),
			createRemoteSessionRoomClient(platform),
			teacher.id,
			sessionId
		);
		return {
			teacher,
			snapshot,
			joinUrl: `${url.origin}/join/${encodeURIComponent(snapshot.joinCode)}`
		};
	} catch (caught) {
		if (caught instanceof ApiError && caught.status === 404) {
			throw error(404, 'Session not found.');
		}
		throw caught;
	}
};
