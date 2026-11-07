import type { RequestHandler } from '@sveltejs/kit';
import { apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';
import { requireAuthenticatedTeacher } from '#lib/server/auth/guard.js';
import { getDb } from '#lib/server/db/client.js';
import { createRemoteSessionRoomClient } from '#lib/server/sessions/room-client.js';
import { getTeacherSessionResults } from '#lib/server/sessions/service.js';

export const GET: RequestHandler = async (event) => {
	try {
		const teacher = requireAuthenticatedTeacher(event.locals.teacher);
		const sessionId = event.params.sessionId ?? '';
		const results = await getTeacherSessionResults(
			getDb(event.platform),
			createRemoteSessionRoomClient(event.platform),
			teacher.id,
			sessionId
		);
		return jsonResponse({ results });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
