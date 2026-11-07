import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import {
	SESSION_COOKIE,
	SESSION_TTL_MS,
	clearSessionCookie,
	generateSessionToken,
	hashSessionToken,
	sessionExpiresAt,
	setSessionCookie
} from '../../src/lib/server/auth/session.js';

function cookieEvent(origin: string, calls: Array<[string, string, unknown]>) {
	return {
		url: new URL(origin),
		cookies: {
			set(name: string, value: string, options: unknown) {
				calls.push([name, value, options]);
			},
			delete(name: string, options: unknown) {
				calls.push([name, '', options]);
			}
		}
	} as unknown as RequestEvent;
}

describe('teacher sessions', () => {
	it('generates unique URL-safe session tokens', () => {
		const first = generateSessionToken();
		const second = generateSessionToken();

		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(second).not.toBe(first);
	});

	it('stores only a deterministic SHA-256 token hash', async () => {
		const token = generateSessionToken();
		const first = await hashSessionToken(token);
		const second = await hashSessionToken(token);

		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(first).toBe(second);
		expect(first).not.toBe(token);
	});

	it('expires sessions after 30 days', () => {
		const now = new Date('2026-01-01T00:00:00.000Z');
		const expiresAt = sessionExpiresAt(now);

		expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
		expect(expiresAt.toISOString()).toBe('2026-01-31T00:00:00.000Z');
	});

	it('sets a secure, HttpOnly, SameSite=Lax cookie on HTTPS', () => {
		const calls: Array<[string, string, unknown]> = [];
		setSessionCookie(cookieEvent('https://quizky.example/login', calls), 'token-value');

		expect(calls).toHaveLength(1);
		expect(calls[0]?.[0]).toBe(SESSION_COOKIE);
		expect(calls[0]?.[1]).toBe('token-value');
		expect(calls[0]?.[2]).toMatchObject({
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			maxAge: 2_592_000
		});
	});

	it('does not mark the cookie Secure on local HTTP', () => {
		const calls: Array<[string, string, unknown]> = [];
		setSessionCookie(cookieEvent('http://localhost:5173/login', calls), 'token-value');

		expect(calls[0]?.[2]).toMatchObject({ secure: false });
	});

	it('clears the session cookie', () => {
		const calls: Array<[string, string, unknown]> = [];
		clearSessionCookie(cookieEvent('https://quizky.example', calls));

		expect(calls[0]?.[0]).toBe(SESSION_COOKIE);
		expect(calls[0]?.[2]).toMatchObject({ path: '/' });
	});
});
