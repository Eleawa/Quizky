import type { RequestHandler } from '@sveltejs/kit';
import { ApiError, apiErrorResponse } from '#lib/server/api/errors.js';
import { getDb, resolvePlatformEnv } from '#lib/server/db/client.js';
import {
	getParticipantTokenFromEvent,
	hashParticipantToken
} from '#lib/server/sessions/credentials.js';
import { findSessionById } from '#lib/server/sessions/repository.js';

const PRIVATE_SERVICE_ORIGIN = 'https://quizky.internal';

export const GET: RequestHandler = async (event) => {
	try {
		if (event.request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
			throw new ApiError(426, 'upgrade_required', 'WebSocket upgrade is required.');
		}

		const origin = event.request.headers.get('origin');
		if (origin && origin !== event.url.origin) {
			throw new ApiError(403, 'forbidden', 'WebSocket origin is not allowed.');
		}

		const sessionId = event.params.sessionId ?? '';
		const db = getDb(event.platform);
		const session = await findSessionById(db, sessionId);
		if (!session) {
			throw new ApiError(404, 'session_not_found', 'Session not found.');
		}

		const headers = new Headers();
		headers.set('upgrade', 'websocket');

		const requestedRole = event.url.searchParams.get('role');
		const referer = (event.request.headers.get('referer') ?? '').toLowerCase();
		const isStudentIntent =
			requestedRole === 'student' || referer.includes('/play/') || referer.includes('/join/');

		const participantToken =
			event.url.searchParams.get('token') ?? getParticipantTokenFromEvent(event, session.id);

		if ((isStudentIntent || participantToken) && requestedRole !== 'teacher') {
			if (participantToken) {
				headers.set(
					'x-quizky-participant-token-hash',
					await hashParticipantToken(participantToken)
				);
			}
		} else if (event.locals.teacher && event.locals.teacher.id === session.teacherId) {
			headers.set('x-quizky-role', 'teacher');
			headers.set('x-quizky-teacher-id', event.locals.teacher.id);
		} else if (participantToken) {
			headers.set('x-quizky-participant-token-hash', await hashParticipantToken(participantToken));
		}

		const service = resolvePlatformEnv(event.platform)?.PRIVATE_SERVICE;
		if (!service) {
			throw new ApiError(
				503,
				'room_unavailable',
				'Live session coordinator is temporarily unavailable.'
			);
		}

		return await service.fetch(
			new Request(`${PRIVATE_SERVICE_ORIGIN}/rooms/${encodeURIComponent(session.id)}/ws`, {
				headers
			})
		);
	} catch (error) {
		return apiErrorResponse(error);
	}
};
