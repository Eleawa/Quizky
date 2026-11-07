import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ApiError } from '#lib/server/api/errors.js';
import { getDb } from '#lib/server/db/client.js';
import { createRemoteSessionRoomClient } from '#lib/server/sessions/room-client.js';
import { getTeacherSessionResults } from '#lib/server/sessions/service.js';

export const load: PageServerLoad = async (event) => {
	const { teacher } = await event.parent();
	try {
		const results = await getTeacherSessionResults(
			getDb(event.platform),
			createRemoteSessionRoomClient(event.platform),
			teacher.id,
			event.params.sessionId
		);
		return {
			results
		};
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			error(404, 'Session not found');
		}
		throw err;
	}
};
