import { DurableObject } from 'cloudflare:workers';
import {
	MAX_PASSWORD_BYTES,
	MAX_PASSWORD_CHARS,
	hashPassword,
	verifyPassword
} from './password-hash.js';
import { SessionRoom, type SessionRoomInfo } from './session-room.js';

export { SessionRoom, type SessionRoomInfo };

interface AuthRequest {
	identity: string;
	password: string;
	hash?: string;
}

const MAX_AUTH_BODY_LENGTH = 4096;
const MAX_STORED_HASH_LENGTH = 256;
const SHARD_RATE_WINDOW_MS = 60_000;
const MAX_SHARD_OPS_PER_WINDOW = 12;
const encoder = new TextEncoder();

function noStoreHeaders(): HeadersInit {
	return { 'cache-control': 'no-store' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

async function readAuthRequest(request: Request): Promise<AuthRequest | null> {
	const text = await request.text();
	if (text.length === 0 || text.length > MAX_AUTH_BODY_LENGTH) return null;

	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return null;
	}

	if (!isRecord(body)) return null;
	const { identity, password, hash } = body;
	if (typeof identity !== 'string' || identity.length === 0 || identity.length > 254) return null;
	if (
		typeof password !== 'string' ||
		password.length === 0 ||
		password.length > MAX_PASSWORD_CHARS
	) {
		return null;
	}
	if (encoder.encode(password).byteLength > MAX_PASSWORD_BYTES) {
		return null;
	}
	if (
		hash !== undefined &&
		(typeof hash !== 'string' || hash.length === 0 || hash.length > MAX_STORED_HASH_LENGTH)
	) {
		return null;
	}
	return { identity, password, hash };
}

async function authShardId(identity: string): Promise<string> {
	const normalized = identity.trim().toLowerCase();
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(normalized));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class PasswordHasher extends DurableObject<Env> {
	private windowStartMs = 0;
	private opsInWindow = 0;

	private checkShardRateLimit(nowMs: number = Date.now()): boolean {
		if (nowMs - this.windowStartMs >= SHARD_RATE_WINDOW_MS) {
			this.windowStartMs = nowMs;
			this.opsInWindow = 1;
			return true;
		}
		if (this.opsInWindow >= MAX_SHARD_OPS_PER_WINDOW) {
			return false;
		}
		this.opsInWindow += 1;
		return true;
	}

	async hash(
		password: string
	): Promise<{ ok: true; hash: string } | { ok: false; code: 'rate_limited' }> {
		if (!this.checkShardRateLimit()) {
			return { ok: false, code: 'rate_limited' };
		}
		return { ok: true, hash: await hashPassword(password) };
	}

	async verify(
		password: string,
		hash: string
	): Promise<{ ok: true; valid: boolean } | { ok: false; code: 'rate_limited' }> {
		if (!this.checkShardRateLimit()) {
			return { ok: false, code: 'rate_limited' };
		}
		return { ok: true, valid: await verifyPassword(password, hash) };
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/auth/hash' || url.pathname === '/auth/verify') {
			if (request.method !== 'POST') {
				return new Response('Method Not Allowed', { status: 405, headers: noStoreHeaders() });
			}

			const body = await readAuthRequest(request);
			if (!body) {
				return Response.json(
					{ error: 'invalid_request' },
					{ status: 400, headers: noStoreHeaders() }
				);
			}

			const stub = env.PASSWORD_HASHER.getByName(await authShardId(body.identity));

			if (url.pathname === '/auth/hash') {
				const result = await stub.hash(body.password);
				if (!result.ok) {
					return Response.json({ error: result.code }, { status: 429, headers: noStoreHeaders() });
				}
				return Response.json({ hash: result.hash }, { headers: noStoreHeaders() });
			}

			if (!body.hash) {
				return Response.json(
					{ error: 'invalid_request' },
					{ status: 400, headers: noStoreHeaders() }
				);
			}

			const result = await stub.verify(body.password, body.hash);
			if (!result.ok) {
				return Response.json({ error: result.code }, { status: 429, headers: noStoreHeaders() });
			}
			return Response.json({ valid: result.valid }, { headers: noStoreHeaders() });
		}

		const roomMatch = /^\/rooms\/([^/]+)\/(init|join|state|export|ws|info)$/.exec(url.pathname);
		if (roomMatch) {
			const sessionId = decodeURIComponent(roomMatch[1] ?? '');
			if (!sessionId) {
				return Response.json(
					{ error: 'invalid_session_id' },
					{ status: 400, headers: noStoreHeaders() }
				);
			}
			const stub = env.SESSION_ROOM.getByName(sessionId);
			return stub.fetch(request);
		}

		const name = url.searchParams.get('room');
		if (!name) {
			return Response.json({ ok: true, service: 'quizky-session-room' });
		}

		const stub = env.SESSION_ROOM.getByName(name);

		if (url.pathname === '/info') {
			return stub.fetch(request);
		}

		return Response.json({ ok: true, pong: await stub.ping() });
	}
} satisfies ExportedHandler<Env>;
