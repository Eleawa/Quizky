import type { RequestHandler } from '@sveltejs/kit';
import { apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';
import { readJson, requireSameOrigin } from '#lib/server/api/request.js';
import { createRemotePasswordHasher } from '#lib/server/auth/password.js';
import { registerTeacher } from '#lib/server/auth/service.js';
import { setSessionCookie } from '#lib/server/auth/session.js';
import { getDb } from '#lib/server/db/client.js';
import {
	enforceIdentityRateLimit,
	enforceRateLimit,
	RATE_LIMIT_POLICIES
} from '#lib/server/security/rate-limit.js';
import { registerSchema } from '#lib/server/validation/auth.js';

export const POST: RequestHandler = async (event) => {
	try {
		requireSameOrigin(event);
		enforceRateLimit(event, 'auth_register', RATE_LIMIT_POLICIES.authRegister);
		const input = await readJson(event, registerSchema);
		enforceIdentityRateLimit('auth_identity', input.email, RATE_LIMIT_POLICIES.authIdentity);
		const result = await registerTeacher(
			getDb(event.platform),
			createRemotePasswordHasher(event),
			input
		);
		setSessionCookie(event, result.token);
		return jsonResponse({ teacher: result.teacher }, { status: 201 });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
