import { dev } from '$app/env';
import { ApiError } from '../api/errors.js';
import { resolvePlatformEnv } from '../db/client.js';
import type {
	GameSessionStatus,
	LeaderboardEntry,
	ParticipantStatus,
	PublicParticipant,
	QuestionPhase,
	RoomSnapshot,
	SessionRole,
	SessionSnapshotQuestion
} from '#lib/shared/session.js';

const DEV_PRIVATE_SERVICE_URL = 'http://127.0.0.1:8788';
const PRIVATE_SERVICE_ORIGIN = 'https://quizky.internal';

export interface RoomInitPayload {
	sessionId: string;
	quizId: string;
	teacherId: string;
	quizTitle: string;
	joinCode: string;
	status: GameSessionStatus;
	createdAt: string;
	questions: SessionSnapshotQuestion[];
}

export interface RoomRegisterParticipantPayload {
	id: string;
	nickname: string;
	nicknameNormalized: string;
	tokenHash: string;
	joinedAt: string;
}

export interface RoomExportedAnswer {
	id: string;
	participantId: string;
	sessionQuestionId: string;
	selectedOptionId: string;
	requestId: string;
	isCorrect: boolean;
	scoreAwarded: number;
	responseTimeMs: number;
	submittedAt: string;
}

export interface RoomExportPayload {
	sessionId: string;
	quizId: string;
	teacherId: string;
	quizTitle: string;
	joinCode: string;
	status: GameSessionStatus;
	questionPhase: QuestionPhase;
	currentQuestionIndex: number;
	createdAt: string;
	startedAt: string | null;
	endedAt: string | null;
	participants: Array<{
		id: string;
		nickname: string;
		status: ParticipantStatus;
		joinedAt: string;
		lastSeenAt: string;
	}>;
	answers: RoomExportedAnswer[];
	leaderboard: LeaderboardEntry[];
}

export interface SessionRoomClient {
	initializeRoom(payload: RoomInitPayload): Promise<RoomSnapshot>;
	registerParticipant(
		sessionId: string,
		payload: RoomRegisterParticipantPayload
	): Promise<PublicParticipant>;
	getRoomState(
		sessionId: string,
		role: SessionRole,
		participantId?: string
	): Promise<RoomSnapshot | null>;
	exportRoomData?(sessionId: string): Promise<RoomExportPayload | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function roomUnavailable(): ApiError {
	return new ApiError(
		503,
		'room_unavailable',
		'Live session coordinator is temporarily unavailable. Try again.'
	);
}

export async function fetchSessionRoomService(
	platform: App.Platform | undefined,
	path: string,
	init: RequestInit
): Promise<Response> {
	try {
		if (dev) {
			const baseUrl = process.env.SESSION_ROOM_DEV_URL ?? DEV_PRIVATE_SERVICE_URL;
			return await fetch(`${baseUrl}${path}`, init);
		}

		const service = resolvePlatformEnv(platform)?.PRIVATE_SERVICE;
		if (!service) throw roomUnavailable();
		return await service.fetch(new Request(`${PRIVATE_SERVICE_ORIGIN}${path}`, init));
	} catch (error) {
		if (error instanceof ApiError) throw error;
		throw roomUnavailable();
	}
}

export function createRemoteSessionRoomClient(
	platform: App.Platform | undefined
): SessionRoomClient {
	return {
		async initializeRoom(payload) {
			const response = await fetchSessionRoomService(
				platform,
				`/rooms/${encodeURIComponent(payload.sessionId)}/init`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload)
				}
			);
			if (!response.ok) throw roomUnavailable();
			const body: unknown = await response.json();
			if (!isRecord(body) || !isRecord(body.snapshot)) throw roomUnavailable();
			return body.snapshot as unknown as RoomSnapshot;
		},

		async registerParticipant(sessionId, payload) {
			const response = await fetchSessionRoomService(
				platform,
				`/rooms/${encodeURIComponent(sessionId)}/join`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload)
				}
			);

			if (response.status === 409) {
				const body: unknown = await response.json().catch(() => null);
				const code =
					isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string'
						? body.error.code
						: 'session_not_joinable';
				if (code === 'nickname_taken') {
					throw new ApiError(
						409,
						'nickname_taken',
						'That nickname is already taken in this game.',
						{ nickname: 'That nickname is already taken in this game.' }
					);
				}
				throw new ApiError(409, 'session_not_joinable', 'This game has already started or ended.');
			}

			if (!response.ok) throw roomUnavailable();
			const body: unknown = await response.json();
			if (!isRecord(body) || !isRecord(body.participant)) throw roomUnavailable();
			return body.participant as unknown as PublicParticipant;
		},

		async getRoomState(sessionId, role, participantId) {
			const headers: Record<string, string> = { 'x-quizky-role': role };
			if (participantId) {
				headers['x-quizky-participant-id'] = participantId;
			}

			try {
				const response = await fetchSessionRoomService(
					platform,
					`/rooms/${encodeURIComponent(sessionId)}/state`,
					{
						method: 'GET',
						headers
					}
				);
				if (response.status === 404) return null;
				if (!response.ok) return null;
				const body: unknown = await response.json();
				if (!isRecord(body) || !isRecord(body.snapshot)) return null;
				return body.snapshot as unknown as RoomSnapshot;
			} catch {
				return null;
			}
		},

		async exportRoomData(sessionId) {
			try {
				const response = await fetchSessionRoomService(
					platform,
					`/rooms/${encodeURIComponent(sessionId)}/export`,
					{ method: 'GET' }
				);
				if (response.status === 404 || !response.ok) return null;
				const body: unknown = await response.json();
				if (!isRecord(body) || !isRecord(body.room)) return null;
				return body.room as unknown as RoomExportPayload;
			} catch {
				return null;
			}
		}
	};
}
