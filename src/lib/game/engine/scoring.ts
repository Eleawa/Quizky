import type {
	LeaderboardEntry,
	PublicQuestion,
	SessionSnapshotQuestion,
	StudentQuestionResult,
	TeacherOptionStatistic,
	TeacherQuestionResult
} from '../../shared/session.js';

export interface ScoringParticipantInput {
	id: string;
	nickname: string;
	joinedAt: string;
}

export interface ScoringAnswerInput {
	participantId: string;
	sessionQuestionId: string;
	selectedOptionId: string;
	isCorrect: boolean;
	scoreAwarded: number;
	responseTimeMs: number;
}

/**
 * MVP scoring rule:
 * - Correct answer: award the question's configured points.
 * - Incorrect or missing answer: 0 points.
 * - No speed bonus in the MVP.
 */
export function calculateAnswerScore(questionPoints: number, isCorrect: boolean): number {
	return isCorrect ? Math.max(0, Math.trunc(questionPoints)) : 0;
}

export function calculateResponseTimeMs(
	openedAtIso: string,
	submittedAtIso: string,
	timeLimitSeconds: number
): number {
	const openedMs = Date.parse(openedAtIso);
	const submittedMs = Date.parse(submittedAtIso);
	if (!Number.isFinite(openedMs) || !Number.isFinite(submittedMs)) {
		return 0;
	}
	const maxMs = Math.max(0, timeLimitSeconds * 1000);
	const elapsed = Math.round(submittedMs - openedMs);
	return Math.max(0, Math.min(maxMs, elapsed));
}

/**
 * Deterministic tie-breaking rule (used everywhere in Quizky):
 * 1. Higher totalScore first
 * 2. Higher correctCount second
 * 3. Lower totalResponseTimeMs third
 * 4. Earlier joinedAt timestamp fourth
 * 5. Lexicographical participantId fifth
 */
export function buildLeaderboard(
	participants: readonly ScoringParticipantInput[],
	answers: readonly ScoringAnswerInput[]
): LeaderboardEntry[] {
	const totals = new Map<
		string,
		{ totalScore: number; correctCount: number; totalResponseTimeMs: number }
	>();

	for (const participant of participants) {
		totals.set(participant.id, {
			totalScore: 0,
			correctCount: 0,
			totalResponseTimeMs: 0
		});
	}

	for (const answer of answers) {
		const entry = totals.get(answer.participantId);
		if (!entry) continue;
		entry.totalScore += answer.scoreAwarded;
		if (answer.isCorrect) {
			entry.correctCount += 1;
		}
		entry.totalResponseTimeMs += Math.max(0, answer.responseTimeMs);
	}

	const sorted = participants.toSorted((a, b) => {
		const statsA = totals.get(a.id) ?? {
			totalScore: 0,
			correctCount: 0,
			totalResponseTimeMs: 0
		};
		const statsB = totals.get(b.id) ?? {
			totalScore: 0,
			correctCount: 0,
			totalResponseTimeMs: 0
		};

		if (statsB.totalScore !== statsA.totalScore) {
			return statsB.totalScore - statsA.totalScore;
		}
		if (statsB.correctCount !== statsA.correctCount) {
			return statsB.correctCount - statsA.correctCount;
		}
		if (statsA.totalResponseTimeMs !== statsB.totalResponseTimeMs) {
			return statsA.totalResponseTimeMs - statsB.totalResponseTimeMs;
		}
		const joinedDiff = Date.parse(a.joinedAt) - Date.parse(b.joinedAt);
		if (Number.isFinite(joinedDiff) && joinedDiff !== 0) {
			return joinedDiff;
		}
		if (a.joinedAt !== b.joinedAt) {
			return a.joinedAt.localeCompare(b.joinedAt);
		}
		return a.id.localeCompare(b.id);
	});

	return sorted.map((participant, index) => {
		const stats = totals.get(participant.id) ?? {
			totalScore: 0,
			correctCount: 0,
			totalResponseTimeMs: 0
		};
		return {
			rank: index + 1,
			participantId: participant.id,
			nickname: participant.nickname,
			totalScore: stats.totalScore,
			correctCount: stats.correctCount,
			totalResponseTimeMs: stats.totalResponseTimeMs
		};
	});
}

export function toPublicQuestion(
	question: SessionSnapshotQuestion,
	totalQuestions: number,
	openedAt: string,
	deadlineAt: string
): PublicQuestion {
	return {
		id: question.id,
		position: question.position,
		totalQuestions,
		text: question.text,
		imageUrl: question.imageUrl ?? null,
		timeLimitSeconds: question.timeLimitSeconds,
		points: question.points,
		openedAt,
		deadlineAt,
		options: question.options.map((option) => ({
			id: option.id,
			text: option.text,
			position: option.position
		}))
	};
}

export function buildQuestionResults(
	question: SessionSnapshotQuestion,
	participants: readonly { id: string }[],
	answersForQuestion: readonly ScoringAnswerInput[]
): {
	teacherResult: TeacherQuestionResult;
	studentResults: Map<string, StudentQuestionResult>;
} {
	const correctOption = question.options.find((opt) => opt.isCorrect) ?? question.options[0];
	const correctOptionId = correctOption?.id ?? '';

	const countsByOption = new Map<string, number>();
	const answerByParticipant = new Map<string, ScoringAnswerInput>();

	for (const answer of answersForQuestion) {
		if (answer.sessionQuestionId !== question.id) continue;
		countsByOption.set(
			answer.selectedOptionId,
			(countsByOption.get(answer.selectedOptionId) ?? 0) + 1
		);
		answerByParticipant.set(answer.participantId, answer);
	}

	const optionStats: TeacherOptionStatistic[] = question.options
		.toSorted((a, b) => a.position - b.position)
		.map((option) => ({
			optionId: option.id,
			text: option.text,
			position: option.position,
			isCorrect: option.isCorrect,
			count: countsByOption.get(option.id) ?? 0
		}));

	const teacherResult: TeacherQuestionResult = {
		role: 'teacher',
		questionId: question.id,
		position: question.position,
		correctOptionId,
		answeredCount: answerByParticipant.size,
		participantCount: participants.length,
		optionStats
	};

	const studentResults = new Map<string, StudentQuestionResult>();
	for (const participant of participants) {
		const submitted = answerByParticipant.get(participant.id);
		studentResults.set(participant.id, {
			role: 'student',
			questionId: question.id,
			position: question.position,
			selectedOptionId: submitted?.selectedOptionId ?? null,
			correctOptionId,
			isCorrect: submitted?.isCorrect ?? false,
			scoreAwarded: submitted?.scoreAwarded ?? 0
		});
	}

	return { teacherResult, studentResults };
}
