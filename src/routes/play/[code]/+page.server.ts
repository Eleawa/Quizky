import { error, redirect } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { ApiError } from '#lib/server/api/errors.js';
import { getDb } from '#lib/server/db/client.js';
import { participantCookieName } from '#lib/server/sessions/credentials.js';
import { findSessionByJoinCode } from '#lib/server/sessions/repository.js';
import { createRemoteSessionRoomClient } from '#lib/server/sessions/room-client.js';
import { getStudentSessionView } from '#lib/server/sessions/service.js';
import { joinCodeSchema } from '#lib/server/validation/session.js';

export const load: ServerLoad = async ({ cookies, locals, params, platform }) => {
	const rawCode = params.code ?? '';
	const parsedCode = joinCodeSchema.safeParse(rawCode);
	if (!parsedCode.success) {
		throw error(404, 'Session not found.');
	}

	const db = getDb(platform);
	const sessionRow = await findSessionByJoinCode(db, parsedCode.data);
	if (!sessionRow) {
		throw error(404, 'Session not found.');
	}

	const participantToken = cookies.get(participantCookieName(sessionRow.id)) ?? null;

	try {
		const view = await getStudentSessionView(
			db,
			createRemoteSessionRoomClient(platform),
			parsedCode.data,
			participantToken
		);

		if (!view.participant || !view.snapshot) {
			throw redirect(303, `/join/${encodeURIComponent(view.session.joinCode)}`);
		}

		return {
			teacher: locals.teacher,
			session: view.session,
			participant: view.participant,
			snapshot: view.snapshot,
			participantToken
		};
	} catch (caught) {
		if (caught instanceof ApiError && caught.status === 404) {
			throw error(404, 'Session not found.');
		}
		throw caught;
	}
};
