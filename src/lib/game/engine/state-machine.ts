import type {
	GameSessionStatus,
	QuestionPhase,
	SessionSnapshotQuestion
} from '../../shared/session.js';
import { calculateAnswerScore, calculateResponseTimeMs } from './scoring.js';

export const AUTO_ADVANCE_DELAY_MS = 4000;

export type EngineErrorCode =
	| 'unauthorized_command'
	| 'invalid_state'
	| 'expired_deadline'
	| 'duplicate_answer'
	| 'invalid_option'
	| 'rate_limited';

export interface EngineRoomState {
	status: GameSessionStatus;
	questionPhase: QuestionPhase;
	currentQuestionIndex: number;
	questionOpenedAt: string | null;
	questionDeadlineAt: string | null;
	startedAt: string | null;
	endedAt: string | null;
}

export type TransitionFailure = {
	ok: false;
	code: EngineErrorCode;
	message: string;
};

export type StartGameTransitionResult =
	| {
			ok: true;
			nextState: EngineRoomState;
			openedQuestion: SessionSnapshotQuestion;
			alarmAtMs: number;
	  }
	| TransitionFailure;

export type SubmitAnswerEvaluation =
	| {
			ok: true;
			questionId: string;
			selectedOptionId: string;
			isCorrect: boolean;
			scoreAwarded: number;
			responseTimeMs: number;
			submittedAt: string;
	  }
	| TransitionFailure;

export type AdvanceTransitionResult =
	| {
			ok: true;
			action: 'question_closed';
			closedQuestion: SessionSnapshotQuestion;
			completedGame: boolean;
			nextState: EngineRoomState;
			alarmAtMs: number | null;
	  }
	| {
			ok: true;
			action: 'question_opened';
			openedQuestion: SessionSnapshotQuestion;
			nextState: EngineRoomState;
			alarmAtMs: number;
	  }
	| {
			ok: true;
			action: 'no_op';
			nextState: EngineRoomState;
			alarmAtMs: number | null;
	  }
	| TransitionFailure;

export type EndGameTransitionResult =
	| {
			ok: true;
			finalStatus: 'completed' | 'cancelled';
			closedActiveQuestion: SessionSnapshotQuestion | null;
			nextState: EngineRoomState;
	  }
	| TransitionFailure;

export type SkipTransitionResult =
	| {
			ok: true;
			action: 'question_skipped';
			skippedQuestion: SessionSnapshotQuestion;
			openedQuestion: SessionSnapshotQuestion;
			completedGame: false;
			nextState: EngineRoomState;
			alarmAtMs: number;
	  }
	| {
			ok: true;
			action: 'game_completed';
			skippedQuestion: SessionSnapshotQuestion;
			completedGame: true;
			nextState: EngineRoomState;
			alarmAtMs: null;
	  }
	| TransitionFailure;

export function transitionStartGame(
	state: EngineRoomState,
	questions: readonly SessionSnapshotQuestion[],
	nowMs: number
): StartGameTransitionResult {
	if (state.status !== 'lobby') {
		return {
			ok: false,
			code: 'invalid_state',
			message: 'The game can only be started while in the lobby.'
		};
	}

	const firstQuestion = questions[0];
	if (!firstQuestion) {
		return {
			ok: false,
			code: 'invalid_state',
			message: 'Cannot start a session without questions.'
		};
	}

	const nowIso = new Date(nowMs).toISOString();
	const deadlineMs = nowMs + firstQuestion.timeLimitSeconds * 1000;
	const deadlineIso = new Date(deadlineMs).toISOString();

	return {
		ok: true,
		openedQuestion: firstQuestion,
		alarmAtMs: deadlineMs,
		nextState: {
			status: 'in_progress',
			questionPhase: 'open',
			currentQuestionIndex: 0,
			questionOpenedAt: nowIso,
			questionDeadlineAt: deadlineIso,
			startedAt: nowIso,
			endedAt: null
		}
	};
}

export function evaluateAnswerSubmission(
	state: EngineRoomState,
	questions: readonly SessionSnapshotQuestion[],
	input: {
		questionId: string;
		optionId: string;
		hasAlreadyAnswered: boolean;
	},
	nowMs: number
): SubmitAnswerEvaluation {
	if (state.status !== 'in_progress' || state.questionPhase !== 'open') {
		return {
			ok: false,
			code: 'invalid_state',
			message: 'No question is currently open for answers.'
		};
	}

	const activeQuestion = questions[state.currentQuestionIndex];
	if (!activeQuestion || activeQuestion.id !== input.questionId) {
		return {
			ok: false,
			code: 'invalid_option',
			message: 'That question is no longer active.'
		};
	}

	if (!state.questionOpenedAt || !state.questionDeadlineAt) {
		return {
			ok: false,
			code: 'invalid_state',
			message: 'Question timing is not active.'
		};
	}

	const deadlineMs = Date.parse(state.questionDeadlineAt);
	if (Number.isFinite(deadlineMs) && nowMs > deadlineMs) {
		return {
			ok: false,
			code: 'expired_deadline',
			message: 'Time has expired for this question.'
		};
	}

	if (input.hasAlreadyAnswered) {
		return {
			ok: false,
			code: 'duplicate_answer',
			message: 'You have already submitted an answer for this question.'
		};
	}

	const selectedOption = activeQuestion.options.find((opt) => opt.id === input.optionId);
	if (!selectedOption) {
		return {
			ok: false,
			code: 'invalid_option',
			message: 'Selected option does not belong to the active question.'
		};
	}

	const submittedAt = new Date(nowMs).toISOString();
	const isCorrect = selectedOption.isCorrect;
	const scoreAwarded = calculateAnswerScore(activeQuestion.points, isCorrect);
	const responseTimeMs = calculateResponseTimeMs(
		state.questionOpenedAt,
		submittedAt,
		activeQuestion.timeLimitSeconds
	);

	return {
		ok: true,
		questionId: activeQuestion.id,
		selectedOptionId: selectedOption.id,
		isCorrect,
		scoreAwarded,
		responseTimeMs,
		submittedAt
	};
}

export function transitionAdvanceOrTimeout(
	state: EngineRoomState,
	questions: readonly SessionSnapshotQuestion[],
	trigger: 'manual' | 'timeout',
	nowMs: number,
	autoAdvanceDelayMs: number = AUTO_ADVANCE_DELAY_MS
): AdvanceTransitionResult {
	if (state.status !== 'in_progress') {
		if (trigger === 'timeout') {
			return { ok: true, action: 'no_op', nextState: state, alarmAtMs: null };
		}
		return {
			ok: false,
			code: 'invalid_state',
			message: 'Session is not currently in progress.'
		};
	}

	if (state.questionPhase === 'open') {
		if (trigger === 'timeout' && state.questionDeadlineAt) {
			const deadlineMs = Date.parse(state.questionDeadlineAt);
			if (Number.isFinite(deadlineMs) && nowMs < deadlineMs) {
				return {
					ok: true,
					action: 'no_op',
					nextState: state,
					alarmAtMs: deadlineMs
				};
			}
		}

		const currentQuestion = questions[state.currentQuestionIndex];
		if (!currentQuestion) {
			return {
				ok: false,
				code: 'invalid_state',
				message: 'Active question could not be found.'
			};
		}

		const isLastQuestion = state.currentQuestionIndex >= questions.length - 1;
		const nowIso = new Date(nowMs).toISOString();

		if (isLastQuestion) {
			return {
				ok: true,
				action: 'question_closed',
				closedQuestion: currentQuestion,
				completedGame: true,
				alarmAtMs: null,
				nextState: {
					...state,
					status: 'completed',
					questionPhase: 'closed',
					questionDeadlineAt: null,
					endedAt: nowIso
				}
			};
		}

		const nextAlarmMs = nowMs + Math.max(0, autoAdvanceDelayMs);
		return {
			ok: true,
			action: 'question_closed',
			closedQuestion: currentQuestion,
			completedGame: false,
			alarmAtMs: nextAlarmMs,
			nextState: {
				...state,
				status: 'in_progress',
				questionPhase: 'closed',
				questionDeadlineAt: new Date(nextAlarmMs).toISOString()
			}
		};
	}

	if (state.questionPhase === 'closed') {
		if (trigger === 'timeout' && state.questionDeadlineAt) {
			const deadlineMs = Date.parse(state.questionDeadlineAt);
			if (Number.isFinite(deadlineMs) && nowMs < deadlineMs) {
				return {
					ok: true,
					action: 'no_op',
					nextState: state,
					alarmAtMs: deadlineMs
				};
			}
		}

		const nextIndex = state.currentQuestionIndex + 1;
		const nextQuestion = questions[nextIndex];
		const nowIso = new Date(nowMs).toISOString();

		if (!nextQuestion) {
			return {
				ok: true,
				action: 'no_op',
				alarmAtMs: null,
				nextState: {
					...state,
					status: 'completed',
					questionPhase: 'closed',
					questionDeadlineAt: null,
					endedAt: nowIso
				}
			};
		}

		const deadlineMs = nowMs + nextQuestion.timeLimitSeconds * 1000;
		const deadlineIso = new Date(deadlineMs).toISOString();

		return {
			ok: true,
			action: 'question_opened',
			openedQuestion: nextQuestion,
			alarmAtMs: deadlineMs,
			nextState: {
				...state,
				status: 'in_progress',
				questionPhase: 'open',
				currentQuestionIndex: nextIndex,
				questionOpenedAt: nowIso,
				questionDeadlineAt: deadlineIso
			}
		};
	}

	return {
		ok: false,
		code: 'invalid_state',
		message: 'Cannot advance from the current question phase.'
	};
}

export function transitionEndGame(
	state: EngineRoomState,
	questions: readonly SessionSnapshotQuestion[],
	nowMs: number
): EndGameTransitionResult {
	const nowIso = new Date(nowMs).toISOString();

	if (state.status === 'lobby') {
		return {
			ok: true,
			finalStatus: 'cancelled',
			closedActiveQuestion: null,
			nextState: {
				...state,
				status: 'cancelled',
				questionPhase: 'closed',
				questionDeadlineAt: null,
				endedAt: nowIso
			}
		};
	}

	if (state.status === 'in_progress') {
		const closedActiveQuestion =
			state.questionPhase === 'open' ? (questions[state.currentQuestionIndex] ?? null) : null;
		return {
			ok: true,
			finalStatus: 'completed',
			closedActiveQuestion,
			nextState: {
				...state,
				status: 'completed',
				questionPhase: 'closed',
				questionDeadlineAt: null,
				endedAt: nowIso
			}
		};
	}

	return {
		ok: false,
		code: 'invalid_state',
		message: 'This session has already ended.'
	};
}

export function transitionSkipQuestion(
	state: EngineRoomState,
	questions: readonly SessionSnapshotQuestion[],
	nowMs: number
): SkipTransitionResult {
	if (state.status !== 'in_progress') {
		return {
			ok: false,
			code: 'invalid_state',
			message: 'Session is not currently in progress.'
		};
	}

	const currentQuestion = questions[state.currentQuestionIndex];
	if (!currentQuestion) {
		return {
			ok: false,
			code: 'invalid_state',
			message: 'Active question could not be found.'
		};
	}

	const isLastQuestion = state.currentQuestionIndex >= questions.length - 1;
	const nowIso = new Date(nowMs).toISOString();

	if (isLastQuestion) {
		return {
			ok: true,
			action: 'game_completed',
			skippedQuestion: currentQuestion,
			completedGame: true,
			alarmAtMs: null,
			nextState: {
				...state,
				status: 'completed',
				questionPhase: 'closed',
				questionDeadlineAt: null,
				endedAt: nowIso
			}
		};
	}

	const nextIndex = state.currentQuestionIndex + 1;
	const nextQuestion = questions[nextIndex];
	if (!nextQuestion) {
		return {
			ok: false,
			code: 'invalid_state',
			message: 'Next question could not be found.'
		};
	}

	const nextDeadlineMs = nowMs + nextQuestion.timeLimitSeconds * 1000;
	return {
		ok: true,
		action: 'question_skipped',
		skippedQuestion: currentQuestion,
		openedQuestion: nextQuestion,
		completedGame: false,
		alarmAtMs: nextDeadlineMs,
		nextState: {
			...state,
			status: 'in_progress',
			questionPhase: 'open',
			currentQuestionIndex: nextIndex,
			questionOpenedAt: nowIso,
			questionDeadlineAt: new Date(nextDeadlineMs).toISOString()
		}
	};
}
