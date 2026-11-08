import { createHash } from 'node:crypto';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';

function parseCookies(header: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(';')) {
		const eqIndex = part.indexOf('=');
		if (eqIndex <= 0) continue;
		const key = part.slice(0, eqIndex).trim();
		const value = part.slice(eqIndex + 1).trim();
		if (key) {
			try {
				out[key] = decodeURIComponent(value);
			} catch {
				out[key] = value;
			}
		}
	}
	return out;
}

function sha256Hex(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function sessionRoomDevWebSocketProxy(): Plugin {
	return {
		name: 'quizky-session-room-ws-dev-proxy',
		configureServer(server) {
			server.httpServer?.on(
				'upgrade',
				async (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
					const match = /^\/api\/sessions\/([^/?]+)\/ws(?:$|\?)/.exec(req.url ?? '');
					if (!match) return;

					const sessionId = decodeURIComponent(match[1] ?? '');
					const cookies = parseCookies(req.headers.cookie);
					const headers: Record<string, string> = {
						connection: 'Upgrade',
						upgrade: 'websocket'
					};

					for (const name of [
						'sec-websocket-key',
						'sec-websocket-version',
						'sec-websocket-extensions',
						'sec-websocket-protocol'
					]) {
						const val = req.headers[name];
						if (typeof val === 'string') headers[name] = val;
					}

					try {
						const d1 = (
							globalThis as {
								__sveltekit_cloudflare_platform?: { env?: { DB?: D1Database } };
							}
						).__sveltekit_cloudflare_platform?.env?.DB;

						const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
						const reqUrl = new URL(req.url ?? '', 'http://127.0.0.1');
						const requestedRole = reqUrl.searchParams.get('role');
						const referer = (req.headers.referer ?? '').toLowerCase();
						const isStudentIntent =
							requestedRole === 'student' ||
							referer.includes('/play/') ||
							referer.includes('/join/');

						const ptToken =
							reqUrl.searchParams.get('token') ?? cookies[`quizky_pt_${safeId}`] ?? undefined;

						if ((isStudentIntent || ptToken) && requestedRole !== 'teacher') {
							if (ptToken) {
								headers['x-quizky-participant-token-hash'] = sha256Hex(ptToken);
							}
						} else {
							const teacherToken = cookies.quizky_teacher;
							if (d1 && teacherToken) {
								const tokenHash = sha256Hex(teacherToken);
								const row = await d1
									.prepare(
										`SELECT s.teacher_id AS teacher_id
										FROM teacher_sessions ts
										INNER JOIN game_sessions s ON s.teacher_id = ts.teacher_id
										WHERE ts.token_hash = ? AND ts.expires_at > ? AND s.id = ?
										LIMIT 1`
									)
									.bind(tokenHash, Date.now(), sessionId)
									.first<{ teacher_id: string }>();

								if (row?.teacher_id) {
									headers['x-quizky-role'] = 'teacher';
									headers['x-quizky-teacher-id'] = row.teacher_id;
								}
							}

							if (!headers['x-quizky-role'] && ptToken) {
								headers['x-quizky-participant-token-hash'] = sha256Hex(ptToken);
							}
						}
					} catch {
						// Proceed without pre-resolved role headers.
					}

					const devRoomUrl = new URL(process.env.SESSION_ROOM_DEV_URL ?? 'http://127.0.0.1:8788');
					const proxyReq = http.request({
						hostname: devRoomUrl.hostname,
						port: Number(devRoomUrl.port || 8788),
						path: `/rooms/${encodeURIComponent(sessionId)}/ws`,
						method: 'GET',
						headers
					});

					proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
						let responseHead = `HTTP/1.1 ${proxyRes.statusCode ?? 101} ${proxyRes.statusMessage ?? 'Switching Protocols'}\r\n`;
						for (const [key, value] of Object.entries(proxyRes.headers)) {
							if (Array.isArray(value)) {
								for (const item of value) {
									responseHead += `${key}: ${item}\r\n`;
								}
							} else if (typeof value === 'string') {
								responseHead += `${key}: ${value}\r\n`;
							}
						}
						responseHead += '\r\n';
						socket.write(responseHead);
						if (proxyHead.length > 0) socket.write(proxyHead);
						if (head.length > 0) proxySocket.write(head);
						proxySocket.pipe(socket);
						socket.pipe(proxySocket);
					});

					proxyReq.on('response', (res) => {
						socket.write(
							`HTTP/1.1 ${res.statusCode ?? 502} ${res.statusMessage ?? 'Bad Gateway'}\r\nConnection: close\r\n\r\n`
						);
						socket.destroy();
					});

					proxyReq.on('error', () => {
						socket.destroy();
					});

					proxyReq.end();
				}
			);
		}
	};
}

export default defineConfig({
	plugins: [
		sessionRoomDevWebSocketProxy(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		hookTimeout: 30_000,
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: [
						'src/**/*.{test,spec}.{js,ts}',
						'tests/unit/**/*.{test,spec}.{js,ts}',
						'tests/integration/**/*.{test,spec}.{js,ts}',
						'tests/e2e/**/*.{test,spec}.{js,ts}',
						'tests/stress/**/*.{test,spec}.{js,ts}'
					],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
