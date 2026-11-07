import type { RequestEvent } from '@sveltejs/kit';

export const SESSION_COOKIE = 'quizky_teacher';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_BYTES = 32;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function generateSessionToken(): string {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export async function hashSessionToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
	return toHex(new Uint8Array(digest));
}

export function sessionExpiresAt(now: Date = new Date()): Date {
	return new Date(now.getTime() + SESSION_TTL_MS);
}

export function setSessionCookie(event: RequestEvent, token: string): void {
	event.cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:',
		maxAge: Math.floor(SESSION_TTL_MS / 1000)
	});
}

export function clearSessionCookie(event: RequestEvent): void {
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
}
