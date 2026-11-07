import type { RequestHandler } from '@sveltejs/kit';
import { apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';
import { getDb } from '#lib/server/db/client.js';
import { enforceRateLimit, RATE_LIMIT_POLICIES } from '#lib/server/security/rate-limit.js';
import { lookupSessionByJoinCode } from '#lib/server/sessions/service.js';

export const GET: RequestHandler = async (event) => {
	try {
		enforceRateLimit(event, 'session_lookup', RATE_LIMIT_POLICIES.sessionLookup);
		const joinCode = event.params.joinCode ?? '';
		const session = await lookupSessionByJoinCode(getDb(event.platform), joinCode);
		return jsonResponse({ session });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
