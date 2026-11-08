import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	buildLeaderboard,
	buildQuestionResults,
	toPublicQuestion
} from '../../src/lib/game/engine/scoring.js';
import {
	evaluateAnswerSubmission,
	transitionAdvanceOrTimeout,
	transitionStartGame,
	type EngineRoomState
} from '../../src/lib/game/engine/state-machine.js';
import { registerTeacher } from '../../src/lib/server/auth/service.js';
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
import { createTeacherQuiz, publishTeacherQuiz } from '../../src/lib/server/quizzes/service.js';
import type {
	RoomExportedAnswer,
	RoomExportPayload,
	RoomInitPayload,
	RoomRegisterParticipantPayload,
	SessionRoomClient
} from '../../src/lib/server/sessions/room-client.js';
import {
	createSessionFromQuiz,
	getStudentSessionView,
	getTeacherSessionLeaderboard,
	getTeacherSessionLobby,
	getTeacherSessionResults,
	joinSessionByCode
} from '../../src/lib/server/sessions/service.js';
import {
	PROTOCOL_VERSION,
	type ParticipantStatus,
	type RoomSnapshot,
	type SessionRole,
	type SessionSnapshotQuestion
} from '../../src/lib/shared/session.js';
import { GET as getLeaderboardEndpoint } from '../../src/routes/api/sessions/[sessionId]/leaderboard/+server.js';
import { GET as getResultsEndpoint } from '../../src/routes/api/sessions/[sessionId]/results/+server.js';

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
		.toSorted()
		.flatMap((file) =>
			readFileSync(join(directory, file), 'utf8')
				.split('--> statement-breakpoint')
				.map((statement) => statement.trim())
				.filter(Boolean)
		);
}

/**
 * In-memory Room harness using the exact Quizky state machine and scoring engine,
 * supporting simulated object restart/hibernation recovery and WebSocket commands.
 */
class TestSessionRoomHarness implements SessionRoomClient {
	private meta: {
		sessionId: string;
		quizId: string;
		teacherId: string;
		quizTitle: string;
		joinCode: string;
		createdAt: string;
	} | null = null;
	private state: EngineRoomState | null = null;
	private questions: SessionSnapshotQuestion[] = [];
	private participants: Array<{
		id: string;
		nickname: string;
		nicknameNormalized: string;
		tokenHash: string;
		status: ParticipantStatus;
		joinedAt: string;
		lastSeenAt: string;
	}> = [];
	private answers: RoomExportedAnswer[] = [];

	async initializeRoom(payload: RoomInitPayload): Promise<RoomSnapshot> {
		this.meta = {
			sessionId: payload.sessionId,
			quizId: payload.quizId,
			teacherId: payload.teacherId,
			quizTitle: payload.quizTitle,
			joinCode: payload.joinCode,
			createdAt: payload.createdAt
		};
		this.state = {
			status: payload.status,
			questionPhase: 'pending',
			currentQuestionIndex: -1,
			questionOpenedAt: null,
			questionDeadlineAt: null,
			startedAt: null,
			endedAt: null
		};
		this.questions = payload.questions;
		this.participants = [];
		this.answers = [];
		const snap = await this.getRoomState(payload.sessionId, 'teacher');
		if (!snap) throw new Error('Expected snapshot');
		return snap;
	}

	async registerParticipant(_sessionId: string, payload: RoomRegisterParticipantPayload) {
		const existing = this.participants.find((p) => p.tokenHash === payload.tokenHash);
		if (existing) {
			existing.status = 'connected';
			existing.lastSeenAt = new Date().toISOString();
			return {
				id: existing.id,
				nickname: existing.nickname,
				status: existing.status,
				joinedAt: existing.joinedAt
			};
		}
		this.participants.push({
			id: payload.id,
			nickname: payload.nickname,
			nicknameNormalized: payload.nicknameNormalized,
			tokenHash: payload.tokenHash,
			status: 'connected',
			joinedAt: payload.joinedAt,
			lastSeenAt: payload.joinedAt
		});
		return {
			id: payload.id,
			nickname: payload.nickname,
			status: 'connected' as const,
			joinedAt: payload.joinedAt
		};
	}

	startGame(nowMs: number) {
		if (!this.state) throw new Error('Not initialized');
		const res = transitionStartGame(this.state, this.questions, nowMs);
		if (!res.ok) throw new Error(res.message);
		this.state = res.nextState;
		return res;
	}

	submitAnswer(
		participantId: string,
		questionId: string,
		optionId: string,
		requestId: string,
		nowMs: number
	) {
		if (!this.state) throw new Error('Not initialized');
		const existing = this.answers.find(
			(a) => a.participantId === participantId && a.sessionQuestionId === questionId
		);
		const evalRes = evaluateAnswerSubmission(
			this.state,
			this.questions,
			{
				questionId,
				optionId,
				hasAlreadyAnswered: Boolean(existing)
			},
			nowMs
		);
		if (!evalRes.ok) return evalRes;

		this.answers.push({
			id: crypto.randomUUID(),
			participantId,
			sessionQuestionId: evalRes.questionId,
			selectedOptionId: evalRes.selectedOptionId,
			requestId,
			isCorrect: evalRes.isCorrect,
			scoreAwarded: evalRes.scoreAwarded,
			responseTimeMs: evalRes.responseTimeMs,
			submittedAt: evalRes.submittedAt
		});
		return evalRes;
	}

	advanceOrTimeout(trigger: 'manual' | 'timeout', nowMs: number) {
		if (!this.state) throw new Error('Not initialized');
		const res = transitionAdvanceOrTimeout(this.state, this.questions, trigger, nowMs);
		if (!res.ok) return res;
		this.state = res.nextState;
		if (this.state.status === 'completed') {
			for (const p of this.participants) {
				p.status = 'finished';
			}
		}
		return res;
	}

	async getRoomState(
		_sessionId: string,
		role: SessionRole,
		participantId?: string
	): Promise<RoomSnapshot | null> {
		if (!this.meta || !this.state) return null;
		const activeQ =
			this.state.currentQuestionIndex >= 0
				? (this.questions[this.state.currentQuestionIndex] ?? null)
				: null;
		const answersForActive = activeQ
			? this.answers.filter((a) => a.sessionQuestionId === activeQ.id)
			: [];
		const myAnswer =
			role === 'student' && participantId
				? answersForActive.find((a) => a.participantId === participantId)
				: undefined;

		let lastQuestionResult = null;
		if (activeQ && this.state.questionPhase === 'closed') {
			const { teacherResult, studentResults } = buildQuestionResults(
				activeQ,
				this.participants,
				answersForActive
			);
			lastQuestionResult =
				role === 'teacher'
					? teacherResult
					: participantId
						? (studentResults.get(participantId) ?? null)
						: null;
		}

		const leaderboard =
			role === 'teacher' ? buildLeaderboard(this.participants, this.answers) : undefined;

		return {
			version: PROTOCOL_VERSION,
			sessionId: this.meta.sessionId,
			joinCode: this.meta.joinCode,
			quizTitle: this.meta.quizTitle,
			role,
			status: this.state.status,
			questionPhase: this.state.questionPhase,
			currentQuestionIndex: this.state.currentQuestionIndex,
			questionCount: this.questions.length,
			participants: this.participants.map((p) => ({
				id: p.id,
				nickname: p.nickname,
				status: p.status,
				joinedAt: p.joinedAt
			})),
			...(participantId ? { selfParticipantId: participantId } : {}),
			currentQuestion:
				this.state.status === 'in_progress' && activeQ && this.state.questionOpenedAt
					? toPublicQuestion(
							activeQ,
							this.questions.length,
							this.state.questionOpenedAt,
							this.state.questionDeadlineAt ?? this.state.questionOpenedAt
						)
					: null,
			answeredCount: answersForActive.length,
			...(role === 'student'
				? {
						hasSubmittedCurrentQuestion: Boolean(myAnswer),
						selectedOptionId: myAnswer?.selectedOptionId ?? null
					}
				: {}),
			lastQuestionResult,
			...(leaderboard ? { leaderboard } : {}),
			startedAt: this.state.startedAt,
			endedAt: this.state.endedAt
		};
	}

	async exportRoomData(): Promise<RoomExportPayload | null> {
		if (!this.meta || !this.state) return null;
		return {
			sessionId: this.meta.sessionId,
			quizId: this.meta.quizId,
			teacherId: this.meta.teacherId,
			quizTitle: this.meta.quizTitle,
			joinCode: this.meta.joinCode,
			status: this.state.status,
			questionPhase: this.state.questionPhase,
			currentQuestionIndex: this.state.currentQuestionIndex,
			createdAt: this.meta.createdAt,
			startedAt: this.state.startedAt,
			endedAt: this.state.endedAt,
			participants: this.participants.map((p) => ({
				id: p.id,
				nickname: p.nickname,
				status: p.status,
				joinedAt: p.joinedAt,
				lastSeenAt: p.lastSeenAt
			})),
			answers: this.answers,
			leaderboard: buildLeaderboard(this.participants, this.answers)
		};
	}
}

let proxy: PlatformProxy;
let db: Database;

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
});

describe('happy-path end-to-end multiplayer quiz flow and reconnect recovery', () => {
	it('executes the 10-step happy path, reconnects without duplicating or resetting timers, and enforces teacher-only results/leaderboard', async () => {
		const room = new TestSessionRoomHarness();

		// 1. Register a teacher
		const { teacher } = await registerTeacher(
			db,
			{
				hash: async (_id: string, pw: string) => `hashed:${pw}`,
				verify: async (_id: string, pw: string, h: string) => h === `hashed:${pw}`
			},
			{
				displayName: 'Prof. Barbara Liskov',
				email: 'liskov@example.com',
				password: 'CorrectHorseBatteryStaple!9'
			}
		);
		expect(teacher.email).toBe('liskov@example.com');

		// 2. Create a quiz with two MCQ questions
		const draft = await createTeacherQuiz(db, teacher.id, {
			title: 'Distributed Systems Quiz',
			description: 'Consensus and fault tolerance',
			questions: [
				{
					text: 'How many faulty nodes can PBFT tolerate out of 3f + 1 nodes?',
					timeLimitSeconds: 20,
					points: 100,
					options: [
						{ text: 'f nodes', isCorrect: true },
						{ text: '2f nodes', isCorrect: false },
						{ text: '3f nodes', isCorrect: false }
					]
				},
				{
					text: 'Which protocol is used for leader election in Raft?',
					timeLimitSeconds: 15,
					points: 200,
					options: [
						{ text: 'Randomized election timeouts', isCorrect: true },
						{ text: 'Proof of Work', isCorrect: false }
					]
				}
			]
		});

		// 3. Publish the quiz
		const published = await publishTeacherQuiz(db, teacher.id, draft.id);
		expect(published.status).toBe('published');

		// 4. Create a live session
		const session = await createSessionFromQuiz(db, room, teacher.id, published.id);
		expect(session.status).toBe('lobby');
		expect(session.questionCount).toBe(2);

		// 5. Join as two students
		const student1 = await joinSessionByCode(db, room, session.joinCode, {
			nickname: 'Leslie Lamport'
		});
		const student2 = await joinSessionByCode(db, room, session.joinCode, {
			nickname: 'Nancy Lynch'
		});
		expect(student1.participant.nickname).toBe('Leslie Lamport');
		expect(student2.participant.nickname).toBe('Nancy Lynch');

		// 6. Start the game
		const t0 = Date.parse('2026-10-30T15:00:00.000Z');
		const startRes = room.startGame(t0);
		expect(startRes.nextState.status).toBe('in_progress');
		expect(startRes.nextState.currentQuestionIndex).toBe(0);
		const q1Deadline = startRes.nextState.questionDeadlineAt;

		// 7. Submit answers from both students on Question 1
		const q1 = session.snapshotQuestions[0]!;
		const q1Correct = q1.options.find((o) => o.isCorrect)!;
		const q1Wrong = q1.options.find((o) => !o.isCorrect)!;

		const s1AnsQ1 = room.submitAnswer(
			student1.participant.id,
			q1.id,
			q1Correct.id,
			'req-s1-q1',
			t0 + 3000
		);
		expect(s1AnsQ1).toMatchObject({ ok: true, isCorrect: true, scoreAwarded: 100 });

		const s2AnsQ1 = room.submitAnswer(
			student2.participant.id,
			q1.id,
			q1Wrong.id,
			'req-s2-q1',
			t0 + 4000
		);
		expect(s2AnsQ1).toMatchObject({ ok: true, isCorrect: false, scoreAwarded: 0 });

		// Verify student 1 reconnect mid-question recovers identity & submission without resetting deadline
		const reconnectedS1 = await joinSessionByCode(db, room, session.joinCode, {
			nickname: 'Leslie Lamport',
			participantToken: student1.participantToken
		});
		expect(reconnectedS1.participant.id).toBe(student1.participant.id);

		const s1MidView = await getStudentSessionView(
			db,
			room,
			session.joinCode,
			student1.participantToken
		);
		expect(s1MidView.snapshot?.participants).toHaveLength(2);
		expect(s1MidView.snapshot?.hasSubmittedCurrentQuestion).toBe(true);
		expect(s1MidView.snapshot?.selectedOptionId).toBe(q1Correct.id);
		expect(s1MidView.snapshot?.currentQuestion?.deadlineAt).toBe(q1Deadline);
		expect(s1MidView.snapshot?.leaderboard).toBeUndefined();

		// 8. Close/advance Question 1 manually and open Question 2
		const closeQ1 = room.advanceOrTimeout('manual', t0 + 8000);
		expect(closeQ1).toMatchObject({ ok: true, action: 'question_closed', completedGame: false });

		const openQ2 = room.advanceOrTimeout('manual', t0 + 10_000);
		expect(openQ2).toMatchObject({ ok: true, action: 'question_opened' });

		// Both students submit correct answers on Question 2 (Nancy answers faster than Leslie)
		const q2 = session.snapshotQuestions[1]!;
		const q2Correct = q2.options.find((o) => o.isCorrect)!;

		room.submitAnswer(student1.participant.id, q2.id, q2Correct.id, 'req-s1-q2', t0 + 12_500);
		room.submitAnswer(student2.participant.id, q2.id, q2Correct.id, 'req-s2-q2', t0 + 11_200);

		// 9. Complete the game via automatic timeout progression when Q2 deadline expires
		const completeQ2 = room.advanceOrTimeout('timeout', t0 + 25_000);
		expect(completeQ2).toMatchObject({
			ok: true,
			action: 'question_closed',
			completedGame: true
		});

		// 10. Verify the teacher sees correct results and students cannot access the leaderboard
		const results = await getTeacherSessionResults(db, room, teacher.id, session.id);
		expect(results.status).toBe('completed');
		expect(results.participantCount).toBe(2);
		expect(results.leaderboard).toHaveLength(2);
		expect(results.leaderboard[0]?.nickname).toBe('Leslie Lamport');
		expect(results.leaderboard[0]?.totalScore).toBe(300);
		expect(results.leaderboard[0]?.correctCount).toBe(2);
		expect(results.leaderboard[1]?.nickname).toBe('Nancy Lynch');
		expect(results.leaderboard[1]?.totalScore).toBe(200);
		expect(results.leaderboard[1]?.correctCount).toBe(1);

		// Verify results survive in D1 even when roomClient is null (simulating DO eviction / Worker redeploy)
		const durableResults = await getTeacherSessionResults(db, null, teacher.id, session.id);
		expect(durableResults.status).toBe('completed');
		expect(durableResults.leaderboard[0]?.totalScore).toBe(300);
		expect(durableResults.questions[0]?.correctCount).toBe(1);
		expect(durableResults.questions[1]?.correctCount).toBe(2);

		const durableTeacherLobby = await getTeacherSessionLobby(db, null, teacher.id, session.id);
		expect(durableTeacherLobby.status).toBe('completed');
		expect(durableTeacherLobby.leaderboard?.[0]?.nickname).toBe('Leslie Lamport');

		const durableLeaderboard = await getTeacherSessionLeaderboard(db, null, teacher.id, session.id);
		expect(durableLeaderboard.entries[0]?.nickname).toBe('Leslie Lamport');

		// Verify students cannot access the teacher-only leaderboard or results HTTP endpoints (401 unauthorized)
		const unauthLeaderboardRes = await getLeaderboardEndpoint({
			locals: { teacher: null, session: null },
			params: { sessionId: session.id }
		} as unknown as Parameters<typeof getLeaderboardEndpoint>[0]);
		expect(unauthLeaderboardRes.status).toBe(401);

		const unauthResultsRes = await getResultsEndpoint({
			locals: { teacher: null, session: null },
			params: { sessionId: session.id }
		} as unknown as Parameters<typeof getResultsEndpoint>[0]);
		expect(unauthResultsRes.status).toBe(401);

		// Verify student completion view never includes leaderboard
		const finalStudentView = await getStudentSessionView(
			db,
			null,
			session.joinCode,
			student1.participantToken
		);
		expect(finalStudentView.session.status).toBe('completed');
		expect(finalStudentView.snapshot?.leaderboard).toBeUndefined();
	});

	it('isolates multiple concurrent rooms with overlapping nicknames, independent timers, and separate results', async () => {
		const roomA = new TestSessionRoomHarness();
		const roomB = new TestSessionRoomHarness();

		const { teacher } = await registerTeacher(
			db,
			{
				hash: async (_id: string, pw: string) => `hashed:${pw}`,
				verify: async (_id: string, pw: string, h: string) => h === `hashed:${pw}`
			},
			{
				displayName: 'Prof. Donald Knuth',
				email: 'knuth@example.com',
				password: 'CorrectHorseBatteryStaple!9'
			}
		);

		const draftA = await createTeacherQuiz(db, teacher.id, {
			title: 'Algorithms Room A',
			description: 'Sorting',
			questions: [
				{
					text: 'Average time complexity of Quicksort?',
					timeLimitSeconds: 20,
					points: 100,
					options: [
						{ text: 'O(n log n)', isCorrect: true },
						{ text: 'O(n^2)', isCorrect: false }
					]
				}
			]
		});
		const draftB = await createTeacherQuiz(db, teacher.id, {
			title: 'Graphs Room B',
			description: 'Shortest paths',
			questions: [
				{
					text: 'Which algorithm handles negative edge weights?',
					timeLimitSeconds: 30,
					points: 250,
					options: [
						{ text: 'Bellman-Ford', isCorrect: true },
						{ text: 'Dijkstra', isCorrect: false }
					]
				}
			]
		});

		const pubA = await publishTeacherQuiz(db, teacher.id, draftA.id);
		const pubB = await publishTeacherQuiz(db, teacher.id, draftB.id);

		const sessionA = await createSessionFromQuiz(db, roomA, teacher.id, pubA.id);
		const sessionB = await createSessionFromQuiz(db, roomB, teacher.id, pubB.id);
		expect(sessionA.id).not.toBe(sessionB.id);
		expect(sessionA.joinCode).not.toBe(sessionB.joinCode);

		// Students with the exact same nickname "Alex" join Room A and Room B simultaneously
		const alexA = await joinSessionByCode(db, roomA, sessionA.joinCode, { nickname: 'Alex' });
		const alexB = await joinSessionByCode(db, roomB, sessionB.joinCode, { nickname: 'Alex' });
		expect(alexA.participant.id).not.toBe(alexB.participant.id);

		const t0 = Date.parse('2026-10-30T16:00:00.000Z');
		roomA.startGame(t0);
		roomB.startGame(t0 + 5000);

		const qA = sessionA.snapshotQuestions[0]!;
		const qB = sessionB.snapshotQuestions[0]!;
		const correctA = qA.options.find((o) => o.isCorrect)!;
		const wrongB = qB.options.find((o) => !o.isCorrect)!;

		// Alex in Room A answers correctly (+100); Alex in Room B answers wrong (+0)
		roomA.submitAnswer(alexA.participant.id, qA.id, correctA.id, 'req-a-1', t0 + 2000);
		roomB.submitAnswer(alexB.participant.id, qB.id, wrongB.id, 'req-b-1', t0 + 7000);

		roomA.advanceOrTimeout('timeout', t0 + 20_000);
		roomB.advanceOrTimeout('manual', t0 + 10_000);

		const resultsA = await getTeacherSessionResults(db, roomA, teacher.id, sessionA.id);
		const resultsB = await getTeacherSessionResults(db, roomB, teacher.id, sessionB.id);

		expect(resultsA.quizTitle).toBe('Algorithms Room A');
		expect(resultsA.leaderboard).toHaveLength(1);
		expect(resultsA.leaderboard[0]?.totalScore).toBe(100);

		expect(resultsB.quizTitle).toBe('Graphs Room B');
		expect(resultsB.leaderboard).toHaveLength(1);
		expect(resultsB.leaderboard[0]?.totalScore).toBe(0);
	});
});
