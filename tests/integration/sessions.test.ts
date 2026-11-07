import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../../src/lib/server/db/client.js';
import {
	gameSessions,
	participantAnswers,
	participants,
	questionOptions,
	questions,
	quizzes,
	sessionQuestionOptions,
	sessionQuestions,
	teacherSessions,
	teachers
} from '../../src/lib/server/db/schema.js';
import {
	createTeacherQuiz,
	publishTeacherQuiz,
	updateTeacherQuiz
} from '../../src/lib/server/quizzes/service.js';
import { hashParticipantToken } from '../../src/lib/server/sessions/credentials.js';
import { getSessionSnapshotQuestions } from '../../src/lib/server/sessions/repository.js';
import type {
	RoomInitPayload,
	RoomRegisterParticipantPayload,
	SessionRoomClient
} from '../../src/lib/server/sessions/room-client.js';
import { PROTOCOL_VERSION, type RoomSnapshot } from '../../src/lib/shared/session.js';
import {
	createSessionFromQuiz,
	getStudentSessionView,
	getTeacherSessionLeaderboard,
	getTeacherSessionLobby,
	getTeacherSessionResults,
	joinSessionByCode,
	listTeacherRecentSessions,
	lookupSessionByJoinCode
} from '../../src/lib/server/sessions/service.js';

interface PlatformProxy {
	env: { DB: D1Database };
	dispose: () => Promise<void>;
}

type GetPlatformProxy = (options?: {
	configPath?: string;
	persist?: boolean;
}) => Promise<PlatformProxy>;

const require = createRequire(import.meta.url);
const { getPlatformProxy } = require('wrangler') as {
	getPlatformProxy: GetPlatformProxy;
};

function migrationStatements(): string[] {
	const directory = join(process.cwd(), 'migrations');
	return readdirSync(directory)
		.filter((file) => file.endsWith('.sql'))
		.sort()
		.flatMap((file) =>
			readFileSync(join(directory, file), 'utf8')
				.split('--> statement-breakpoint')
				.map((statement) => statement.trim())
				.filter(Boolean)
		);
}

let proxy: PlatformProxy;
let db: Database;

const teacherAId = 'teacher-a';
const teacherBId = 'teacher-b';

beforeAll(async () => {
	proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: false });
	for (const statement of migrationStatements()) {
		await proxy.env.DB.prepare(statement).run();
	}
	db = createDb(proxy.env.DB);
});

afterAll(async () => {
	await proxy.dispose();
});

beforeEach(async () => {
	await db.delete(participantAnswers);
	await db.delete(participants);
	await db.delete(sessionQuestionOptions);
	await db.delete(sessionQuestions);
	await db.delete(gameSessions);
	await db.delete(questionOptions);
	await db.delete(questions);
	await db.delete(quizzes);
	await db.delete(teacherSessions);
	await db.delete(teachers);

	const now = new Date('2026-10-30T12:00:00.000Z');
	await db.insert(teachers).values([
		{
			id: teacherAId,
			email: 'ada@example.com',
			passwordHash: 'hash-a',
			displayName: 'Ada',
			createdAt: now,
			updatedAt: now
		},
		{
			id: teacherBId,
			email: 'grace@example.com',
			passwordHash: 'hash-b',
			displayName: 'Grace',
			createdAt: now,
			updatedAt: now
		}
	]);
});

async function createPublishedQuizForAda() {
	const draft = await createTeacherQuiz(db, teacherAId, {
		title: 'Algorithms 101',
		description: 'Sorting and searching',
		questions: [
			{
				text: 'Binary search time complexity?',
				imageUrl: '/api/images/binary-tree',
				timeLimitSeconds: 20,
				points: 100,
				options: [
					{ text: 'O(log n)', isCorrect: true },
					{ text: 'O(n)', isCorrect: false },
					{ text: 'O(n^2)', isCorrect: false }
				]
			},
			{
				text: 'Merge sort space complexity?',
				timeLimitSeconds: 25,
				points: 150,
				options: [
					{ text: 'O(1)', isCorrect: false },
					{ text: 'O(n)', isCorrect: true }
				]
			}
		]
	});
	return publishTeacherQuiz(db, teacherAId, draft.id);
}

function buildMockSnapshot(payload: RoomInitPayload): RoomSnapshot {
	return {
		version: PROTOCOL_VERSION,
		sessionId: payload.sessionId,
		joinCode: payload.joinCode,
		quizTitle: payload.quizTitle,
		role: 'teacher',
		status: payload.status,
		questionPhase: 'pending',
		currentQuestionIndex: -1,
		questionCount: payload.questions.length,
		participants: [],
		currentQuestion: null,
		answeredCount: 0
	};
}

describe('session creation, snapshot immutability, and student lobby joins', () => {
	it('rejects creating a session from a draft quiz or a quiz owned by another teacher', async () => {
		const draft = await createTeacherQuiz(db, teacherAId, {
			title: 'Draft Quiz',
			description: null,
			questions: [
				{
					text: 'Q1',
					timeLimitSeconds: 20,
					points: 100,
					options: [
						{ text: 'A', isCorrect: true },
						{ text: 'B', isCorrect: false }
					]
				}
			]
		});

		await expect(createSessionFromQuiz(db, null, teacherAId, draft.id)).rejects.toMatchObject({
			status: 409,
			code: 'quiz_not_published'
		});

		const published = await publishTeacherQuiz(db, teacherAId, draft.id);

		await expect(createSessionFromQuiz(db, null, teacherBId, published.id)).rejects.toMatchObject({
			status: 404,
			code: 'quiz_not_found'
		});
	});

	it('creates an immutable question/option snapshot unaffected by subsequent quiz edits', async () => {
		const quiz = await createPublishedQuizForAda();

		const initializedPayloads: RoomInitPayload[] = [];
		const mockRoomClient: SessionRoomClient = {
			initializeRoom: async (payload) => {
				initializedPayloads.push(payload);
				return buildMockSnapshot(payload);
			},
			registerParticipant: async () => ({
				id: 'p1',
				nickname: 'Student',
				status: 'connected',
				joinedAt: new Date().toISOString()
			}),
			getRoomState: async () => null
		};

		const session = await createSessionFromQuiz(db, mockRoomClient, teacherAId, quiz.id);
		expect(session.status).toBe('lobby');
		expect(session.joinCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
		expect(session.questionCount).toBe(2);
		expect(session.snapshotQuestions[0]?.imageUrl).toBe('/api/images/binary-tree');
		expect(session.snapshotQuestions[1]?.imageUrl).toBeNull();
		expect(initializedPayloads).toHaveLength(1);
		expect(initializedPayloads[0]?.sessionId).toBe(session.id);
		expect(initializedPayloads[0]?.questions[0]?.imageUrl).toBe('/api/images/binary-tree');

		// Now mutate the original quiz
		await updateTeacherQuiz(db, teacherAId, quiz.id, {
			title: 'Mutated Quiz Title',
			description: 'Changed after session started',
			questions: [
				{
					text: 'Completely different question?',
					timeLimitSeconds: 10,
					points: 500,
					options: [
						{ text: 'New Option 1', isCorrect: false },
						{ text: 'New Option 2', isCorrect: true }
					]
				}
			]
		});

		// Verify the session's snapshot in D1 still has the original title, 2 questions, and original options
		const snapshotQuestions = await getSessionSnapshotQuestions(db, session.id);
		expect(snapshotQuestions).toHaveLength(2);
		expect(snapshotQuestions[0]?.text).toBe('Binary search time complexity?');
		expect(snapshotQuestions[0]?.options).toHaveLength(3);
		expect(snapshotQuestions[0]?.options[0]?.text).toBe('O(log n)');
		expect(snapshotQuestions[0]?.options[0]?.isCorrect).toBe(true);
		expect(snapshotQuestions[1]?.text).toBe('Merge sort space complexity?');

		const lobby = await getTeacherSessionLobby(db, null, teacherAId, session.id);
		expect(lobby.quizTitle).toBe('Algorithms 101');
		expect(lobby.questionCount).toBe(2);
	});

	it('allows students to look up by join code, join with unique nicknames, and reconnect with token', async () => {
		const quiz = await createPublishedQuizForAda();
		const registeredInRoom: RoomRegisterParticipantPayload[] = [];
		const mockRoomClient: SessionRoomClient = {
			initializeRoom: async (payload) => buildMockSnapshot(payload),
			registerParticipant: async (_sessionId, payload) => {
				registeredInRoom.push(payload);
				return {
					id: payload.id,
					nickname: payload.nickname,
					status: 'connected',
					joinedAt: payload.joinedAt
				};
			},
			getRoomState: async () => null
		};

		const session = await createSessionFromQuiz(db, mockRoomClient, teacherAId, quiz.id);

		// Case-insensitive lookup with whitespace
		const lookup = await lookupSessionByJoinCode(db, `  ${session.joinCode.toLowerCase()} `);
		expect(lookup.sessionId).toBe(session.id);
		expect(lookup.quizTitle).toBe('Algorithms 101');
		expect(lookup.participantCount).toBe(0);

		// Student 1 joins
		const student1 = await joinSessionByCode(db, mockRoomClient, session.joinCode, {
			nickname: 'Alan Turing'
		});
		expect(student1.participant.nickname).toBe('Alan Turing');
		expect(student1.participantToken).toBeTruthy();
		expect(registeredInRoom).toHaveLength(1);

		// Verify raw token is NOT stored in D1; only SHA-256 hash is stored
		const storedRows = await db
			.select()
			.from(participants)
			.where(eq(participants.id, student1.participant.id));
		expect(storedRows).toHaveLength(1);
		const expectedHash = await hashParticipantToken(student1.participantToken);
		expect(storedRows[0]?.participantTokenHash).toBe(expectedHash);
		expect(storedRows[0]?.participantTokenHash).not.toBe(student1.participantToken);

		// Duplicate nickname (different casing) is rejected with 409 nickname_taken
		await expect(
			joinSessionByCode(db, mockRoomClient, session.joinCode, {
				nickname: 'alan turing'
			})
		).rejects.toMatchObject({
			status: 409,
			code: 'nickname_taken'
		});

		// Re-joining with the same participantToken recovers the existing participant idempotently
		const reconnected = await joinSessionByCode(db, mockRoomClient, session.joinCode, {
			nickname: 'alan turing',
			participantToken: student1.participantToken
		});
		expect(reconnected.participant.id).toBe(student1.participant.id);

		// Student 2 joins with a distinct nickname
		const student2 = await joinSessionByCode(db, mockRoomClient, session.joinCode, {
			nickname: 'Margaret Hamilton'
		});
		expect(student2.participant.id).not.toBe(student1.participant.id);

		// Verify student session view returns participant and room snapshot
		const studentView = await getStudentSessionView(
			db,
			null,
			session.joinCode,
			student1.participantToken
		);
		expect(studentView.participant?.id).toBe(student1.participant.id);
		expect(studentView.snapshot?.participants).toHaveLength(2);
		expect(studentView.snapshot?.selfParticipantId).toBe(student1.participant.id);
	});

	it('syncs completed room state and answers into D1 and computes teacher-only leaderboard', async () => {
		const quiz = await createPublishedQuizForAda();
		const session = await createSessionFromQuiz(db, null, teacherAId, quiz.id);

		const student1 = await joinSessionByCode(db, null, session.joinCode, {
			nickname: 'Alan Turing'
		});
		const student2 = await joinSessionByCode(db, null, session.joinCode, {
			nickname: 'Grace Hopper'
		});

		const q1 = session.snapshotQuestions[0]!;
		const q1Correct = q1.options.find((o) => o.isCorrect)!;
		const q1Wrong = q1.options.find((o) => !o.isCorrect)!;

		const mockCompletedRoom: SessionRoomClient = {
			initializeRoom: async (payload) => buildMockSnapshot(payload),
			registerParticipant: async (_sessionId, payload) => ({
				id: payload.id,
				nickname: payload.nickname,
				status: 'connected',
				joinedAt: payload.joinedAt
			}),
			getRoomState: async () => null,
			exportRoomData: async () => ({
				sessionId: session.id,
				quizId: quiz.id,
				teacherId: teacherAId,
				quizTitle: session.quizTitle,
				joinCode: session.joinCode,
				status: 'completed',
				questionPhase: 'closed',
				currentQuestionIndex: 1,
				createdAt: session.createdAt.toISOString(),
				startedAt: '2026-10-30T12:01:00.000Z',
				endedAt: '2026-10-30T12:02:00.000Z',
				participants: [
					{
						id: student1.participant.id,
						nickname: student1.participant.nickname,
						status: 'finished',
						joinedAt: student1.participant.joinedAt,
						lastSeenAt: '2026-10-30T12:02:00.000Z'
					},
					{
						id: student2.participant.id,
						nickname: student2.participant.nickname,
						status: 'finished',
						joinedAt: student2.participant.joinedAt,
						lastSeenAt: '2026-10-30T12:02:00.000Z'
					}
				],
				answers: [
					{
						id: 'ans-1',
						participantId: student1.participant.id,
						sessionQuestionId: q1.id,
						selectedOptionId: q1Correct.id,
						requestId: 'req-1',
						isCorrect: true,
						scoreAwarded: q1.points,
						responseTimeMs: 2400,
						submittedAt: '2026-10-30T12:01:02.400Z'
					},
					{
						id: 'ans-2',
						participantId: student2.participant.id,
						sessionQuestionId: q1.id,
						selectedOptionId: q1Wrong.id,
						requestId: 'req-2',
						isCorrect: false,
						scoreAwarded: 0,
						responseTimeMs: 1800,
						submittedAt: '2026-10-30T12:01:01.800Z'
					}
				],
				leaderboard: []
			})
		};

		const teacherSnap = await getTeacherSessionLobby(db, mockCompletedRoom, teacherAId, session.id);
		expect(teacherSnap.leaderboard).toBeDefined();
		expect(teacherSnap.leaderboard?.[0]?.nickname).toBe('Alan Turing');
		expect(teacherSnap.leaderboard?.[0]?.totalScore).toBe(q1.points);
		expect(teacherSnap.leaderboard?.[1]?.nickname).toBe('Grace Hopper');
		expect(teacherSnap.leaderboard?.[1]?.totalScore).toBe(0);

		// Student view must never include leaderboard
		const studentView = await getStudentSessionView(
			db,
			null,
			session.joinCode,
			student1.participantToken
		);
		expect(studentView.session.status).toBe('completed');
		expect(studentView.snapshot?.leaderboard).toBeUndefined();

		// Other teacher cannot access leaderboard or results
		await expect(
			getTeacherSessionLeaderboard(db, null, teacherBId, session.id)
		).rejects.toMatchObject({
			status: 404,
			code: 'session_not_found'
		});
		await expect(getTeacherSessionResults(db, null, teacherBId, session.id)).rejects.toMatchObject({
			status: 404,
			code: 'session_not_found'
		});

		// Owning teacher can retrieve persistent leaderboard and full question-by-question results from D1 even with roomClient = null
		const persistedLeaderboard = await getTeacherSessionLeaderboard(
			db,
			null,
			teacherAId,
			session.id
		);
		expect(persistedLeaderboard.entries).toHaveLength(2);
		expect(persistedLeaderboard.entries[0]?.nickname).toBe('Alan Turing');
		expect(persistedLeaderboard.entries[0]?.totalScore).toBe(q1.points);

		const persistedResults = await getTeacherSessionResults(db, null, teacherAId, session.id);
		expect(persistedResults.status).toBe('completed');
		expect(persistedResults.participantCount).toBe(2);
		expect(persistedResults.questions).toHaveLength(2);
		expect(persistedResults.questions[0]?.answeredCount).toBe(2);
		expect(persistedResults.questions[0]?.correctCount).toBe(1);
		expect(persistedResults.questions[0]?.participantAnswers).toHaveLength(2);

		const recentSessions = await listTeacherRecentSessions(db, teacherAId);
		expect(recentSessions).toHaveLength(1);
		expect(recentSessions[0]?.id).toBe(session.id);
		expect(recentSessions[0]?.status).toBe('completed');
	});
});
