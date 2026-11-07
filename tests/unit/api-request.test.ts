import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/server/api/errors.js';
import { readJson, requireSameOrigin } from '../../src/lib/server/api/request.js';
import { loginSchema } from '../../src/lib/server/validation/auth.js';

function requestEvent(
	body: BodyInit | null = null,
	headers: Record<string, string> = {}
): RequestEvent {
	const url = 'https://quizky.example/api/auth/login';
	return {
		url: new URL(url),
		request: new Request(url, { method: 'POST', headers, body })
	} as unknown as RequestEvent;
}

describe('API request guards', () => {
	it('accepts same-origin requests', () => {
		expect(() =>
			requireSameOrigin(requestEvent(null, { origin: 'https://quizky.example' }))
		).not.toThrow();
	});

	it('rejects cross-origin requests', () => {
		expect(() => requireSameOrigin(requestEvent(null, { origin: 'https://evil.example' }))).toThrow(
			ApiError
		);
	});

	it('rejects requests without an Origin header', () => {
		expect(() => requireSameOrigin(requestEvent())).toThrow(ApiError);
	});

	it('parses and validates JSON bodies', async () => {
		const input = await readJson(
			requestEvent(JSON.stringify({ email: 'Teacher@Example.com', password: 'secret' }), {
				'content-type': 'application/json'
			}),
			loginSchema
		);

		expect(input.email).toBe('teacher@example.com');
	});

	it('rejects malformed JSON bodies', async () => {
		await expect(readJson(requestEvent('{'), loginSchema)).rejects.toMatchObject({
			status: 400,
			code: 'invalid_request'
		});
	});
});
