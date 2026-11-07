import { describe, expect, it } from 'vitest';
import {
	buildLeaderboard,
	buildQuestionResults,
	calculateAnswerScore,
	calculateResponseTimeMs,
	toPublicQuestion
} from '../../src/lib/game/engine/scoring.js';
import {
	AUTO_ADVANCE_DELAY_MS,
	evaluateAnswerSubmission,
	transitionAdvanceOrTimeout,
	transitionEndGame,
	transitionStartGame,
	type EngineRoomState
} from '../../src/lib/game/engine/state-machine.js';
import type { SessionSnapshotQuestion } from '../../src/lib/shared/session.js';

const sampleQuestions: SessionSnapshotQuestion[] = [
	{
		id: 'q-1',
		sourceQuestionId: 'src-1',
		text: 'What is 2 + 2?',
		position: 0,
		timeLimitSeconds: 20,
		points: 100,
		options: [
			{ id: 'q1-opt-a', text: '3', position: 0, isCorrect: false },
			{ id: 'q1-opt-b', text: '4', position: 1, isCorrect: true },
			{ id: 'q1-opt-c', text: '5', position: 2, isCorrect: false }
		]
	},
	{
		id: 'q-2',
		sourceQuestionId: 'src-2',
		text: 'Capital of France?',
		position: 1,
		timeLimitSeconds: 15,
		points: 200,
		options: [
			{ id: 'q2-opt-a', text: 'Paris', position: 0, isCorrect: true },
			{ id: 'q2-opt-b', text: 'Lyon', position: 1, isCorrect: false }
		]
	}
];

function createLobbyState(): EngineRoomState {
	return {
		status: 'lobby',
		questionPhase: 'pending',
		currentQuestionIndex: -1,
		questionOpenedAt: null,
		questionDeadlineAt: null,
		startedAt: null,
		endedAt: null
	};
}

describe('scoring, tie-breaking, and role-specific payload filtering', () => {
	it('awards full points for correct answers and 0 for incorrect answers', () => {
		expect(calculateAnswerScore(100, true)).toBe(100);
		expect(calculateAnswerScore(100, false)).toBe(0);
	});

	it('clamps responseTimeMs within [0, timeLimitSeconds * 1000]', () => {
		const openedAt = '2026-10-30T12:00:00.000Z';
		expect(calculateResponseTimeMs(openedAt, '2026-10-30T12:00:03.450Z', 20)).toBe(3450);
		expect(calculateResponseTimeMs(openedAt, '2026-10-30T11:59:59.000Z', 20)).toBe(0);
		expect(calculateResponseTimeMs(openedAt, '2026-10-30T12:00:35.000Z', 20)).toBe(20000);
	});

	it('applies deterministic tie-breaking: score -> correctCount -> responseTimeMs -> joinedAt -> id', () => {
		const participants = [
			{ id: 'p-charlie', nickname: 'Charlie', joinedAt: '2026-10-30T12:00:05.000Z' },
			{ id: 'p-alice', nickname: 'Alice', joinedAt: '2026-10-30T12:00:01.000Z' },
			{ id: 'p-bob', nickname: 'Bob', joinedAt: '2026-10-30T12:00:02.000Z' },
			{ id: 'p-diana', nickname: 'Diana', joinedAt: '2026-10-30T12:00:01.000Z' }
		];

		// Alice: 200 pts (2 correct, 4000ms)
		// Bob: 200 pts (1 correct, 1000ms) -> behind Alice because fewer correct answers
		// Charlie: 100 pts (1 correct, 2000ms)
		// Diana: 100 pts (1 correct, 2000ms) -> ties Charlie on score, correctCount, responseTime, but joined earlier!
		const answers = [
			{
				participantId: 'p-alice',
				sessionQuestionId: 'q-1',
				selectedOptionId: 'q1-opt-b',
				isCorrect: true,
				scoreAwarded: 100,
				responseTimeMs: 2000
			},
			{
				participantId: 'p-alice',
				sessionQuestionId: 'q-2',
				selectedOptionId: 'q2-opt-a',
				isCorrect: true,
				scoreAwarded: 100,
				responseTimeMs: 2000
			},
			{
				participantId: 'p-bob',
				sessionQuestionId: 'q-2',
				selectedOptionId: 'q2-opt-a',
				isCorrect: true,
				scoreAwarded: 200,
				responseTimeMs: 1000
			},
			{
				participantId: 'p-charlie',
				sessionQuestionId: 'q-1',
				selectedOptionId: 'q1-opt-b',
				isCorrect: true,
				scoreAwarded: 100,
				responseTimeMs: 2000
			},
			{
				participantId: 'p-diana',
				sessionQuestionId: 'q-1',
				selectedOptionId: 'q1-opt-b',
				isCorrect: true,
				scoreAwarded: 100,
				responseTimeMs: 2000
			}
		];

		const leaderboard = buildLeaderboard(participants, answers);
		expect(leaderboard.map((entry) => entry.nickname)).toEqual([
			'Alice',
			'Bob',
			'Diana',
			'Charlie'
		]);
		expect(leaderboard.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
	});

	it('strips isCorrect from PublicQuestion and builds separate teacher/student results', () => {
		const q1 = sampleQuestions[0]!;
		const pub = toPublicQuestion(
			q1,
			sampleQuestions.length,
			'2026-10-30T12:00:00.000Z',
			'2026-10-30T12:00:20.000Z'
		);

		for (const opt of pub.options) {
			expect('isCorrect' in opt).toBe(false);
		}

		const { teacherResult, studentResults } = buildQuestionResults(
			q1,
			[{ id: 'p-1' }, { id: 'p-2' }],
			[
				{
					participantId: 'p-1',
					sessionQuestionId: 'q-1',
					selectedOptionId: 'q1-opt-b',
					isCorrect: true,
					scoreAwarded: 100,
					responseTimeMs: 1500
				}
			]
		);

		expect(teacherResult.role).toBe('teacher');
		expect(teacherResult.correctOptionId).toBe('q1-opt-b');
		expect(teacherResult.answeredCount).toBe(1);
		expect(teacherResult.optionStats.find((s) => s.optionId === 'q1-opt-b')?.count).toBe(1);

		const p1Result = studentResults.get('p-1')!;
		expect(p1Result.role).toBe('student');
		expect(p1Result.isCorrect).toBe(true);
		expect(p1Result.scoreAwarded).toBe(100);
		expect('optionStats' in p1Result).toBe(false);

		const p2Result = studentResults.get('p-2')!;
		expect(p2Result.selectedOptionId).toBeNull();
		expect(p2Result.isCorrect).toBe(false);
		expect(p2Result.scoreAwarded).toBe(0);
	});
});

describe('game state machine transitions, deadlines, and answer validation', () => {
	it('starts game from lobby, opens question 0, and rejects starting again', () => {
		const t0 = Date.parse('2026-10-30T12:00:00.000Z');
		const lobby = createLobbyState();

		const started = transitionStartGame(lobby, sampleQuestions, t0);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		expect(started.nextState.status).toBe('in_progress');
		expect(started.nextState.questionPhase).toBe('open');
		expect(started.nextState.currentQuestionIndex).toBe(0);
		expect(started.alarmAtMs).toBe(t0 + 20_000);

		const duplicateStart = transitionStartGame(started.nextState, sampleQuestions, t0 + 1000);
		expect(duplicateStart).toMatchObject({
			ok: false,
			code: 'invalid_state'
		});
	});

	it('validates student answers, enforces deadlines, and rejects duplicates or invalid options', () => {
		const t0 = Date.parse('2026-10-30T12:00:00.000Z');
		const started = transitionStartGame(createLobbyState(), sampleQuestions, t0);
		if (!started.ok) throw new Error('Expected start');

		// Valid correct answer within deadline (at +5s)
		const validEval = evaluateAnswerSubmission(
			started.nextState,
			sampleQuestions,
			{
				questionId: 'q-1',
				optionId: 'q1-opt-b',
				hasAlreadyAnswered: false
			},
			t0 + 5000
		);
		expect(validEval).toMatchObject({
			ok: true,
			isCorrect: true,
			scoreAwarded: 100,
			responseTimeMs: 5000
		});

		// Duplicate answer rejected
		const dupEval = evaluateAnswerSubmission(
			started.nextState,
			sampleQuestions,
			{
				questionId: 'q-1',
				optionId: 'q1-opt-a',
				hasAlreadyAnswered: true
			},
			t0 + 6000
		);
		expect(dupEval).toMatchObject({
			ok: false,
			code: 'duplicate_answer'
		});

		// Invalid option ID rejected
		const badOptEval = evaluateAnswerSubmission(
			started.nextState,
			sampleQuestions,
			{
				questionId: 'q-1',
				optionId: 'q2-opt-a',
				hasAlreadyAnswered: false
			},
			t0 + 6000
		);
		expect(badOptEval).toMatchObject({
			ok: false,
			code: 'invalid_option'
		});

		// Late answer (after 20s deadline) rejected with expired_deadline
		const lateEval = evaluateAnswerSubmission(
			started.nextState,
			sampleQuestions,
			{
				questionId: 'q-1',
				optionId: 'q1-opt-b',
				hasAlreadyAnswered: false
			},
			t0 + 20_001
		);
		expect(lateEval).toMatchObject({
			ok: false,
			code: 'expired_deadline'
		});
	});

	it('progresses through OPEN -> CLOSED -> OPEN -> CLOSED -> COMPLETED via manual and timeout triggers', () => {
		const t0 = Date.parse('2026-10-30T12:00:00.000Z');
		const started = transitionStartGame(createLobbyState(), sampleQuestions, t0);
		if (!started.ok) throw new Error('Expected start');

		// Early timeout before deadline is a no_op
		const earlyTimeout = transitionAdvanceOrTimeout(
			started.nextState,
			sampleQuestions,
			'timeout',
			t0 + 5000
		);
		expect(earlyTimeout).toMatchObject({
			ok: true,
			action: 'no_op'
		});

		// Manual advance at +8s closes Question 1 (not last question -> schedules auto-advance alarm)
		const closeQ1 = transitionAdvanceOrTimeout(
			started.nextState,
			sampleQuestions,
			'manual',
			t0 + 8000
		);
		expect(closeQ1).toMatchObject({
			ok: true,
			action: 'question_closed',
			completedGame: false,
			alarmAtMs: t0 + 8000 + AUTO_ADVANCE_DELAY_MS
		});
		if (!closeQ1.ok || closeQ1.action !== 'question_closed') throw new Error('Expected closeQ1');
		expect(closeQ1.nextState.questionPhase).toBe('closed');
		expect(closeQ1.nextState.status).toBe('in_progress');

		// Timeout after AUTO_ADVANCE_DELAY_MS opens Question 2
		const tOpenQ2 = t0 + 8000 + AUTO_ADVANCE_DELAY_MS;
		const openQ2 = transitionAdvanceOrTimeout(
			closeQ1.nextState,
			sampleQuestions,
			'timeout',
			tOpenQ2
		);
		expect(openQ2).toMatchObject({
			ok: true,
			action: 'question_opened',
			alarmAtMs: tOpenQ2 + 15_000
		});
		if (!openQ2.ok || openQ2.action !== 'question_opened') throw new Error('Expected openQ2');
		expect(openQ2.nextState.currentQuestionIndex).toBe(1);
		expect(openQ2.nextState.questionPhase).toBe('open');

		// Timeout when Question 2 deadline expires closes Question 2 AND marks game completed
		const tEndQ2 = tOpenQ2 + 15_000;
		const closeQ2 = transitionAdvanceOrTimeout(
			openQ2.nextState,
			sampleQuestions,
			'timeout',
			tEndQ2
		);
		expect(closeQ2).toMatchObject({
			ok: true,
			action: 'question_closed',
			completedGame: true,
			alarmAtMs: null
		});
		if (!closeQ2.ok || closeQ2.action !== 'question_closed') throw new Error('Expected closeQ2');
		expect(closeQ2.nextState.status).toBe('completed');
		expect(closeQ2.nextState.questionPhase).toBe('closed');
		expect(closeQ2.nextState.endedAt).toBe(new Date(tEndQ2).toISOString());
	});

	it('cancels a lobby or ends an active game early via transitionEndGame', () => {
		const t0 = Date.parse('2026-10-30T12:00:00.000Z');
		const cancelled = transitionEndGame(createLobbyState(), sampleQuestions, t0);
		expect(cancelled).toMatchObject({
			ok: true,
			finalStatus: 'cancelled'
		});

		const started = transitionStartGame(createLobbyState(), sampleQuestions, t0);
		if (!started.ok) throw new Error('Expected start');

		const endedEarly = transitionEndGame(started.nextState, sampleQuestions, t0 + 3000);
		expect(endedEarly).toMatchObject({
			ok: true,
			finalStatus: 'completed'
		});
		if (!endedEarly.ok) return;
		expect(endedEarly.closedActiveQuestion?.id).toBe('q-1');
	});
});
