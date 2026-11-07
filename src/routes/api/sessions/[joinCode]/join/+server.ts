import type { RequestHandler } from '@sveltejs/kit';
import { apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';
import { readJson, requireSameOrigin } from '#lib/server/api/request.js';
import { getDb } from '#lib/server/db/client.js';
import { enforceRateLimit, RATE_LIMIT_POLICIES } from '#lib/server/security/rate-limit.js';
import {
	getParticipantTokenFromEvent,
	setParticipantCookie
} from '#lib/server/sessions/credentials.js';
import { findSessionByJoinCode } from '#lib/server/sessions/repository.js';
import { createRemoteSessionRoomClient } from '#lib/server/sessions/room-client.js';
import { joinSessionByCode } from '#lib/server/sessions/service.js';
import { joinCodeSchema, joinSessionRequestSchema } from '#lib/server/validation/session.js';

export const POST: RequestHandler = async (event) => {
	try {
		requireSameOrigin(event);
		enforceRateLimit(event, 'session_join', RATE_LIMIT_POLICIES.sessionJoin);
		const joinCode = event.params.joinCode ?? '';
		const input = await readJson(event, joinSessionRequestSchema);
		const db = getDb(event.platform);

		let existingToken = input.participantToken;
		if (!existingToken) {
			const parsedCode = joinCodeSchema.safeParse(joinCode);
			if (parsedCode.success) {
				const existingSession = await findSessionByJoinCode(db, parsedCode.data);
				if (existingSession) {
					existingToken = getParticipantTokenFromEvent(event, existingSession.id) ?? undefined;
				}
			}
		}

		const result = await joinSessionByCode(
			db,
			createRemoteSessionRoomClient(event.platform),
			joinCode,
			{
				nickname: input.nickname,
				participantToken: existingToken
			}
		);

		setParticipantCookie(event, result.sessionId, result.participantToken);
		return jsonResponse({ session: result }, { status: 201 });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
