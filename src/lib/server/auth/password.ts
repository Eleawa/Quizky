import { dev } from '$app/env';
import type { RequestEvent } from '@sveltejs/kit';
import { ApiError } from '../api/errors.js';
import { resolvePlatformEnv } from '../db/client.js';
import type { PasswordHasher } from './types.js';

const DEV_PRIVATE_SERVICE_URL = 'http://127.0.0.1:8788';
const PRIVATE_SERVICE_ORIGIN = 'https://quizky.internal';

function unavailable(): ApiError {
	return new ApiError(
		503,
		'auth_unavailable',
		'Authentication is temporarily unavailable. Try again.'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

async function callPrivateService(
	event: RequestEvent,
	path: string,
	body: Record<string, string>
): Promise<unknown> {
	const payload = JSON.stringify(body);
	const headers = { 'content-type': 'application/json' };

	let response: Response;
	try {
		if (dev) {
			response = await fetch(`${DEV_PRIVATE_SERVICE_URL}${path}`, {
				method: 'POST',
				headers,
				body: payload
			});
		} else {
			const service = resolvePlatformEnv(event.platform)?.PRIVATE_SERVICE;
			if (!service) throw unavailable();
			response = await service.fetch(
				new Request(`${PRIVATE_SERVICE_ORIGIN}${path}`, {
					method: 'POST',
					headers,
					body: payload
				})
			);
		}
	} catch (error) {
		if (error instanceof ApiError) throw error;
		throw unavailable();
	}

	if (response.status === 429) {
		throw new ApiError(
			429,
			'rate_limited',
			'Too many authentication attempts. Please wait a moment and try again.'
		);
	}

	if (!response.ok) throw unavailable();

	try {
		return await response.json();
	} catch {
		throw unavailable();
	}
}

export function createRemotePasswordHasher(event: RequestEvent): PasswordHasher {
	return {
		async hash(identity, password) {
			const result = await callPrivateService(event, '/auth/hash', { identity, password });
			if (!isRecord(result) || typeof result.hash !== 'string') throw unavailable();
			return result.hash;
		},
		async verify(identity, password, hash) {
			const result = await callPrivateService(event, '/auth/verify', {
				identity,
				password,
				hash
			});
			if (!isRecord(result) || typeof result.valid !== 'boolean') throw unavailable();
			return result.valid;
		}
	};
}
