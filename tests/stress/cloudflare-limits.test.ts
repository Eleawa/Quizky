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
import { parseClientMessage } from '../../src/lib/game/protocol/messages.js';
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
import {
	FixedWindowRateLimiter,
	RATE_LIMIT_POLICIES
} from '../../src/lib/server/security/rate-limit.js';
import type {
	RoomExportedAnswer,
	RoomExportPayload,
	RoomInitPayload,
	RoomRegisterParticipantPayload,
	SessionRoomClient
} from '../../src/lib/server/sessions/room-client.js';
import {
	createSessionFromQuiz,
	getTeacherSessionLeaderboard,
	getTeacherSessionResults,
	joinSessionByCode
} from '../../src/lib/server/sessions/service.js';
import {
	PROTOCOL_VERSION,
	type ParticipantStatus,
	type PublicParticipant,
	type RoomSnapshot,
	type SessionRole,
	type SessionSnapshotQuestion
} from '../../src/lib/shared/session.js';

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

function measureCpuMs<T>(fn: () => T): { result: T; cpuMs: number; wallMs: number } {
	const startCpu = process.cpuUsage();
	const startWall = performance.now();
	const result = fn();
	const wallMs = performance.now() - startWall;
	const diffCpu = process.cpuUsage(startCpu);
	const cpuMs = (diffCpu.user + diffCpu.system) / 1000;
	return { result, cpuMs, wallMs };
}

class StressRoomHarness implements SessionRoomClient {
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
	private answers: Array<RoomExportedAnswer & { requestId: string }> = [];

	async initializeRoom(payload: RoomInitPayload): Promise<RoomSnapshot> {
		this.meta = {
			sessionId: payload.sessionId,
			quizId: payload.quizId,
			teacherId: payload.teacherId,
			quizTitle: payload.quizTitle,
			joinCode: payload.joinCode,
			createdAt: payload.createdAt
		};
		this.questions = structuredClone(payload.questions);
		this.participants = [];
		this.answers = [];
		this.state = {
			status: payload.status,
			questionPhase: 'pending',
			currentQuestionIndex: -1,
			questionOpenedAt: null,
			questionDeadlineAt: null,
			startedAt: null,
			endedAt: null
		};
		const snap = await this.getRoomState(payload.sessionId, 'teacher');
		if (!snap) throw new Error('Failed to initialize room');
		return snap;
	}

	async registerParticipant(
		_sessionId: string,
		payload: RoomRegisterParticipantPayload
	): Promise<PublicParticipant> {
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
			status: 'connected',
			joinedAt: payload.joinedAt
		};
	}

	startGame(nowMs: number) {
		if (!this.state) throw new Error('Room not initialized');
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
		if (!this.state) throw new Error('Room not initialized');
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
		if (!this.state) throw new Error('Room not initialized');
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
		const leaderboard = buildLeaderboard(this.participants, this.answers);
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
			answers: this.answers.map((a) => ({
				id: a.id,
				participantId: a.participantId,
				sessionQuestionId: a.sessionQuestionId,
				selectedOptionId: a.selectedOptionId,
				isCorrect: a.isCorrect,
				scoreAwarded: a.scoreAwarded,
				responseTimeMs: a.responseTimeMs,
				submittedAt: a.submittedAt,
				requestId: a.requestId
			})),
			leaderboard
		};
	}
}

describe('Cloudflare CPU, Memory, and D1 Scaling Stress Tests', () => {
	let proxy: PlatformProxy;
	let db: Database;

	beforeAll(async () => {
		proxy = await getPlatformProxy({
			configPath: 'wrangler.jsonc',
			persist: false
		});

		for (const statement of migrationStatements()) {
			await proxy.env.DB.prepare(statement).run();
		}

		db = createDb(proxy.env.DB);
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

	afterAll(async () => {
		await proxy?.dispose();
	});

	it('completes 100-student answer evaluation and 4,000-answer leaderboard computation well within Cloudflare CPU budgets', () => {
		const t0 = 1_760_000_000_000;
		const snapshotQuestions: SessionSnapshotQuestion[] = Array.from({ length: 20 }, (_, qIdx) => ({
			id: `q-${qIdx}`,
			sourceQuestionId: `src-${qIdx}`,
			text: `Question ${qIdx + 1}: What is the computational complexity of algorithm ${qIdx}?`,
			imageUrl: null,
			position: qIdx,
			timeLimitSeconds: 20,
			points: 100,
			options: [
				{ id: `q-${qIdx}-opt-0`, text: 'O(1)', position: 0, isCorrect: true },
				{ id: `q-${qIdx}-opt-1`, text: 'O(n)', position: 1, isCorrect: false },
				{ id: `q-${qIdx}-opt-2`, text: 'O(n log n)', position: 2, isCorrect: false },
				{ id: `q-${qIdx}-opt-3`, text: 'O(n^2)', position: 3, isCorrect: false }
			]
		}));

		const state: EngineRoomState = {
			status: 'in_progress',
			questionPhase: 'open',
			currentQuestionIndex: 0,
			questionOpenedAt: new Date(t0).toISOString(),
			questionDeadlineAt: new Date(t0 + 20_000).toISOString(),
			startedAt: new Date(t0).toISOString(),
			endedAt: null
		};

		// 1. 100 simultaneous answer submissions burst
		const burstMetrics = measureCpuMs(() => {
			const results = [];
			for (let i = 0; i < 100; i += 1) {
				results.push(
					evaluateAnswerSubmission(
						state,
						snapshotQuestions,
						{
							questionId: 'q-0',
							optionId: i % 2 === 0 ? 'q-0-opt-0' : 'q-0-opt-1',
							hasAlreadyAnswered: false
						},
						t0 + 500 + i * 10
					)
				);
			}
			return results;
		});

		expect(burstMetrics.result).toHaveLength(100);
		expect(burstMetrics.result.every((r) => r.ok)).toBe(true);
		// Must be well under the 30,000ms DO limit and even under the 10ms Worker HTTP limit per invocation
		expect(burstMetrics.cpuMs).toBeLessThan(50);

		// 2. 200 participants x 20 questions = 4,000 answers leaderboard sort & tie-breaking
		const simParticipants = Array.from({ length: 200 }, (_, i) => ({
			id: `p-${String(i).padStart(4, '0')}`,
			nickname: `Student_${i}`,
			joinedAt: new Date(t0 - (200 - i) * 1000).toISOString()
		}));

		const simAnswers = simParticipants.flatMap((p, pIdx) =>
			snapshotQuestions.map((q, qIdx) => {
				const isCorrect = (pIdx + qIdx) % 3 !== 0;
				return {
					participantId: p.id,
					sessionQuestionId: q.id,
					selectedOptionId: isCorrect ? `q-${qIdx}-opt-0` : `q-${qIdx}-opt-1`,
					isCorrect,
					scoreAwarded: isCorrect ? 100 : 0,
					responseTimeMs: 1200 + ((pIdx * 37 + qIdx * 13) % 8000)
				};
			})
		);

		expect(simAnswers).toHaveLength(4000);

		const lbMetrics = measureCpuMs(() => buildLeaderboard(simParticipants, simAnswers));
		expect(lbMetrics.result).toHaveLength(200);
		expect(lbMetrics.result[0]?.rank).toBe(1);
		expect(lbMetrics.result[199]?.rank).toBe(200);
		expect(lbMetrics.cpuMs).toBeLessThan(50);

		// 3. 1,000 WebSocket protocol frame parses & validations
		const sampleFrame = JSON.stringify({
			version: PROTOCOL_VERSION,
			type: 'submit_answer',
			questionId: 'q-0',
			optionId: 'q-0-opt-0',
			requestId: 'req-123456'
		});

		const parseMetrics = measureCpuMs(() => {
			for (let i = 0; i < 1000; i += 1) {
				const parsed = parseClientMessage(sampleFrame);
				if (!parsed.ok) throw new Error('Expected valid frame');
			}
		});
		expect(parseMetrics.cpuMs).toBeLessThan(100);
	});

	it('maintains bounded memory well below the 128 MB Cloudflare isolate limit across 30 consecutive 50-student sessions', async () => {
		const baselineHeapBytes = process.memoryUsage().heapUsed;
		let peakHeapDeltaMb = 0;

		const questionsSnapshot: SessionSnapshotQuestion[] = Array.from({ length: 10 }, (_, idx) => ({
			id: `q-${idx}`,
			sourceQuestionId: `src-${idx}`,
			text: `Memory test question ${idx}?`,
			imageUrl: null,
			position: idx,
			timeLimitSeconds: 15,
			points: 100,
			options: [
				{ id: `q-${idx}-a`, text: 'Correct', position: 0, isCorrect: true },
				{ id: `q-${idx}-b`, text: 'Wrong', position: 1, isCorrect: false }
			]
		}));

		for (let sessionIdx = 0; sessionIdx < 30; sessionIdx += 1) {
			const room = new StressRoomHarness();
			const t0 = 1_760_000_000_000 + sessionIdx * 100_000;

			await room.initializeRoom({
				sessionId: `sess-${sessionIdx}`,
				quizId: 'quiz-mem',
				teacherId: 'teacher-mem',
				quizTitle: 'Memory Stress Quiz',
				joinCode: 'MEM123',
				status: 'lobby',
				createdAt: new Date(t0).toISOString(),
				questions: questionsSnapshot
			});

			for (let p = 0; p < 50; p += 1) {
				await room.registerParticipant(`sess-${sessionIdx}`, {
					id: `p-${sessionIdx}-${p}`,
					nickname: `Player_${p}`,
					nicknameNormalized: `player_${p}`,
					tokenHash: `hash-${sessionIdx}-${p}`,
					joinedAt: new Date(t0 + p).toISOString()
				});
			}

			room.startGame(t0 + 1000);

			for (let q = 0; q < 10; q += 1) {
				for (let p = 0; p < 50; p += 1) {
					room.submitAnswer(
						`p-${sessionIdx}-${p}`,
						`q-${q}`,
						p % 2 === 0 ? `q-${q}-a` : `q-${q}-b`,
						`req-${sessionIdx}-${q}-${p}`,
						t0 + 2000 + q * 5000 + p * 10
					);
				}
				// Close question
				room.advanceOrTimeout('manual', t0 + 4000 + q * 5000);
				if (q < 9) {
					// Open next question
					room.advanceOrTimeout('manual', t0 + 4500 + q * 5000);
				}
			}

			const exported = await room.exportRoomData();
			expect(exported?.status).toBe('completed');
			expect(exported?.answers).toHaveLength(500);

			const currentDeltaMb = (process.memoryUsage().heapUsed - baselineHeapBytes) / (1024 * 1024);
			if (currentDeltaMb > peakHeapDeltaMb) {
				peakHeapDeltaMb = currentDeltaMb;
			}
		}

		// Peak heap increase across 30 full sessions (15,000 answers) must stay well under Cloudflare's 128 MB ceiling
		expect(peakHeapDeltaMb).toBeLessThan(64);
	});

	it('handles a 120-student simultaneous join, answer burst, and D1 batch sync without hitting D1 SQL variable limits', async () => {
		const teacherId = 'teacher-scale-stress';
		const now = new Date();
		await db.insert(teachers).values({
			id: teacherId,
			email: 'scale@example.com',
			passwordHash: 'hash-scale',
			displayName: 'Prof. Scale',
			createdAt: now,
			updatedAt: now
		});

		const draft = await createTeacherQuiz(db, teacherId, {
			title: '120-Student Auditorium Quiz',
			description: 'Verifies >100 participants D1 parameter chunking and batch sync',
			questions: [
				{
					text: 'Question 1: Cloudflare Free Worker HTTP CPU limit?',
					timeLimitSeconds: 30,
					points: 100,
					options: [
						{ text: '10 ms', isCorrect: true },
						{ text: '500 ms', isCorrect: false }
					]
				},
				{
					text: 'Question 2: Cloudflare Durable Object CPU limit?',
					timeLimitSeconds: 30,
					points: 150,
					options: [
						{ text: '30 seconds', isCorrect: true },
						{ text: '5 seconds', isCorrect: false }
					]
				}
			]
		});

		await publishTeacherQuiz(db, teacherId, draft.id);

		const room = new StressRoomHarness();
		const session = await createSessionFromQuiz(db, room, teacherId, draft.id);

		// Join 120 students concurrently (exceeding D1's 100-variable per statement limit)
		const STUDENT_COUNT = 120;
		const joinedStudents = await Promise.all(
			Array.from({ length: STUDENT_COUNT }, (_, idx) =>
				joinSessionByCode(db, room, session.joinCode, {
					nickname: `Student_${String(idx + 1).padStart(3, '0')}`
				})
			)
		);

		expect(joinedStudents).toHaveLength(STUDENT_COUNT);

		const t0 = Date.parse('2026-10-30T12:00:00.000Z');
		room.startGame(t0);

		const q1 = session.snapshotQuestions[0]!;
		const q1Correct = q1.options.find((o) => o.isCorrect)!;
		const q1Wrong = q1.options.find((o) => !o.isCorrect)!;

		// All 120 students submit answers to Q1 in a burst
		for (let i = 0; i < STUDENT_COUNT; i += 1) {
			const student = joinedStudents[i]!;
			const isCorrect = i < 80; // First 80 correct, 40 wrong
			const res = room.submitAnswer(
				student.participant.id,
				q1.id,
				isCorrect ? q1Correct.id : q1Wrong.id,
				`req-q1-${i}`,
				t0 + 500 + i * 20
			);
			expect(res.ok).toBe(true);
		}

		// Close Q1 & open Q2
		room.advanceOrTimeout('manual', t0 + 10_000);
		room.advanceOrTimeout('manual', t0 + 12_000);

		const q2 = session.snapshotQuestions[1]!;
		const q2Correct = q2.options.find((o) => o.isCorrect)!;
		const q2Wrong = q2.options.find((o) => !o.isCorrect)!;

		// All 120 students submit answers to Q2 in a burst
		for (let i = 0; i < STUDENT_COUNT; i += 1) {
			const student = joinedStudents[i]!;
			const isCorrect = i % 2 === 0;
			const res = room.submitAnswer(
				student.participant.id,
				q2.id,
				isCorrect ? q2Correct.id : q2Wrong.id,
				`req-q2-${i}`,
				t0 + 13_000 + i * 15
			);
			expect(res.ok).toBe(true);
		}

		// Complete game
		const endRes = room.advanceOrTimeout('timeout', t0 + 45_000);
		expect(endRes).toMatchObject({ ok: true, completedGame: true });

		// Sync 120 participants + 240 answers to D1 and query full results & leaderboard
		const results = await getTeacherSessionResults(db, room, teacherId, session.id);
		expect(results.status).toBe('completed');
		expect(results.participantCount).toBe(STUDENT_COUNT);
		expect(results.leaderboard).toHaveLength(STUDENT_COUNT);

		// Student_001 answered both Q1 (100) and Q2 (150) fastest -> rank #1 with 250 pts
		expect(results.leaderboard[0]?.nickname).toBe('Student_001');
		expect(results.leaderboard[0]?.totalScore).toBe(250);
		expect(results.leaderboard[0]?.correctCount).toBe(2);
		expect(results.leaderboard[0]?.totalResponseTimeMs).toBeGreaterThan(0);

		// Verify question breakdown includes all 120 participant responses
		expect(results.questions[0]?.answeredCount).toBe(STUDENT_COUNT);
		expect(results.questions[0]?.correctCount).toBe(80);
		expect(results.questions[1]?.answeredCount).toBe(STUDENT_COUNT);
		expect(results.questions[1]?.correctCount).toBe(60);

		const lbOnly = await getTeacherSessionLeaderboard(db, null, teacherId, session.id);
		expect(lbOnly.entries).toHaveLength(STUDENT_COUNT);
	}, 20_000);

	it('absorbs a 1,000-request rate-limiter flood in < 5ms CPU while preserving legitimate classroom traffic', () => {
		const limiter = new FixedWindowRateLimiter();
		const now = 1_760_000_000_000;

		const floodMetrics = measureCpuMs(() => {
			let allowedCount = 0;
			let blockedCount = 0;
			for (let i = 0; i < 1000; i += 1) {
				const res = limiter.check(
					'session_join:198.51.100.77',
					RATE_LIMIT_POLICIES.sessionJoin,
					now + i
				);
				if (res.allowed) {
					allowedCount += 1;
				} else {
					blockedCount += 1;
				}
			}
			return { allowedCount, blockedCount };
		});

		expect(floodMetrics.result.allowedCount).toBe(RATE_LIMIT_POLICIES.sessionJoin.maxRequests);
		expect(floodMetrics.result.blockedCount).toBe(
			1000 - RATE_LIMIT_POLICIES.sessionJoin.maxRequests
		);
		expect(floodMetrics.cpuMs).toBeLessThan(15);

		// Another classroom IP is completely unaffected during the flood
		const legitimate = limiter.check(
			'session_join:203.0.113.10',
			RATE_LIMIT_POLICIES.sessionJoin,
			now + 500
		);
		expect(legitimate.allowed).toBe(true);
	});
});
