import type { RequestEvent } from '@sveltejs/kit';
import type { ZodType } from 'zod';
import { ApiError } from './errors.js';
import { fieldErrors } from '../validation/auth.js';

const MAX_JSON_BODY_LENGTH = 65_536;

export async function readJson<T>(event: RequestEvent, schema: ZodType<T>): Promise<T> {
	const text = await event.request.text();
	if (text.length === 0 || text.length > MAX_JSON_BODY_LENGTH) {
		throw new ApiError(400, 'invalid_request', 'Request body is invalid.');
	}

	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		throw new ApiError(400, 'invalid_request', 'Request body must be valid JSON.');
	}

	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		throw new ApiError(
			400,
			'invalid_request',
			'Check the highlighted fields.',
			fieldErrors(parsed.error)
		);
	}

	return parsed.data;
}

export function requireSameOrigin(event: RequestEvent): void {
	const origin = event.request.headers.get('origin');
	if (origin !== event.url.origin) {
		throw new ApiError(403, 'forbidden', 'Request origin is not allowed.');
	}
}
