import type { RequestEvent } from '@sveltejs/kit';
import { generateSessionToken, hashSessionToken } from '../auth/session.js';

export const PARTICIPANT_COOKIE_TTL_SECONDS = 24 * 60 * 60;

export function generateParticipantToken(): string {
	return generateSessionToken();
}

export async function hashParticipantToken(token: string): Promise<string> {
	return hashSessionToken(token);
}

export function participantCookieName(sessionId: string): string {
	const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
	return `quizky_pt_${safeId}`;
}

export function setParticipantCookie(event: RequestEvent, sessionId: string, token: string): void {
	event.cookies.set(participantCookieName(sessionId), token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:',
		maxAge: PARTICIPANT_COOKIE_TTL_SECONDS
	});
}

export function getParticipantTokenFromEvent(
	event: RequestEvent,
	sessionId: string,
	explicitToken?: string
): string | null {
	if (explicitToken && explicitToken.trim().length > 0) {
		return explicitToken.trim();
	}
	return event.cookies.get(participantCookieName(sessionId)) ?? null;
}
