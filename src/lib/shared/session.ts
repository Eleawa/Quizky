export const PROTOCOL_VERSION = 1 as const;

export const JOIN_CODE_LENGTH = 6;
export const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const NICKNAME_LIMITS = {
	minLength: 2,
	maxLength: 24
} as const;

export const SESSION_STATUSES = ['lobby', 'in_progress', 'completed', 'cancelled'] as const;
export type GameSessionStatus = (typeof SESSION_STATUSES)[number];

export const QUESTION_PHASES = ['pending', 'open', 'closed'] as const;
export type QuestionPhase = (typeof QUESTION_PHASES)[number];

export const PARTICIPANT_STATUSES = ['connected', 'disconnected', 'finished'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export type SessionRole = 'teacher' | 'student';

export interface PublicParticipant {
	id: string;
	nickname: string;
	status: ParticipantStatus;
	joinedAt: string;
}

export interface PublicSessionLookup {
	sessionId: string;
	joinCode: string;
	quizTitle: string;
	status: GameSessionStatus;
	questionCount: number;
	participantCount: number;
}

export interface StudentJoinResponse {
	sessionId: string;
	joinCode: string;
	quizTitle: string;
	status: GameSessionStatus;
	participant: PublicParticipant;
	participantToken: string;
}

export interface SessionSnapshotOption {
	id: string;
	text: string;
	position: number;
	isCorrect: boolean;
}

export interface SessionSnapshotQuestion {
	id: string;
	sourceQuestionId: string | null;
	text: string;
	imageUrl?: string | null;
	position: number;
	timeLimitSeconds: number;
	points: number;
	options: SessionSnapshotOption[];
}

export interface PublicQuestionOption {
	id: string;
	text: string;
	position: number;
}

export interface PublicQuestion {
	id: string;
	position: number;
	totalQuestions: number;
	text: string;
	imageUrl?: string | null;
	timeLimitSeconds: number;
	points: number;
	openedAt: string;
	deadlineAt: string;
	options: PublicQuestionOption[];
}

export interface TeacherOptionStatistic {
	optionId: string;
	text: string;
	position: number;
	isCorrect: boolean;
	count: number;
}

export interface TeacherQuestionResult {
	role: 'teacher';
	questionId: string;
	position: number;
	correctOptionId: string;
	answeredCount: number;
	participantCount: number;
	optionStats: TeacherOptionStatistic[];
}

export interface StudentQuestionResult {
	role: 'student';
	questionId: string;
	position: number;
	selectedOptionId: string | null;
	correctOptionId: string;
	isCorrect: boolean;
	scoreAwarded: number;
}

export type QuestionResultForRole = TeacherQuestionResult | StudentQuestionResult;

export interface LeaderboardEntry {
	rank: number;
	participantId: string;
	nickname: string;
	totalScore: number;
	correctCount: number;
	totalResponseTimeMs: number;
}

export interface TeacherLeaderboard {
	sessionId: string;
	entries: LeaderboardEntry[];
}

export interface GameSummary {
	sessionId: string;
	status: GameSessionStatus;
	endedAt: string;
	questionCount: number;
	participantCount: number;
	leaderboard?: LeaderboardEntry[];
}

export interface RoomSnapshot {
	version: typeof PROTOCOL_VERSION;
	sessionId: string;
	joinCode: string;
	quizTitle: string;
	role: SessionRole;
	status: GameSessionStatus;
	questionPhase: QuestionPhase;
	currentQuestionIndex: number;
	questionCount: number;
	participants: PublicParticipant[];
	selfParticipantId?: string;
	currentQuestion: PublicQuestion | null;
	answeredCount: number;
	hasSubmittedCurrentQuestion?: boolean;
	selectedOptionId?: string | null;
	lastQuestionResult?: QuestionResultForRole | null;
	leaderboard?: LeaderboardEntry[];
	startedAt?: string | null;
	endedAt?: string | null;
}

export interface TeacherParticipantQuestionAnswer {
	participantId: string;
	nickname: string;
	selectedOptionId: string | null;
	selectedOptionText: string | null;
	isCorrect: boolean;
	scoreAwarded: number;
	responseTimeMs: number | null;
	submittedAt: string | null;
}

export interface TeacherSessionQuestionBreakdown {
	questionId: string;
	position: number;
	text: string;
	imageUrl?: string | null;
	timeLimitSeconds: number;
	points: number;
	correctOptionId: string;
	answeredCount: number;
	correctCount: number;
	participantCount: number;
	optionStats: TeacherOptionStatistic[];
	participantAnswers: TeacherParticipantQuestionAnswer[];
}

export interface TeacherSessionResults {
	sessionId: string;
	quizId: string;
	quizTitle: string;
	joinCode: string;
	status: GameSessionStatus;
	createdAt: string;
	startedAt: string | null;
	endedAt: string | null;
	questionCount: number;
	participantCount: number;
	leaderboard: LeaderboardEntry[];
	questions: TeacherSessionQuestionBreakdown[];
}

export interface TeacherSessionListItem {
	id: string;
	quizId: string;
	quizTitle: string;
	joinCode: string;
	status: GameSessionStatus;
	questionCount: number;
	participantCount: number;
	createdAt: string;
	startedAt: string | null;
	endedAt: string | null;
}
