export const QUIZ_STATUSES = ['draft', 'published', 'archived'] as const;
export type QuizStatus = (typeof QUIZ_STATUSES)[number];

export const QUIZ_LIMITS = {
	maxTitleLength: 120,
	maxDescriptionLength: 500,
	minQuestionsToPublish: 1,
	maxQuestions: 50,
	maxQuestionTextLength: 1000,
	minOptions: 2,
	maxOptions: 6,
	maxOptionTextLength: 160,
	minTimeLimitSeconds: 5,
	maxTimeLimitSeconds: 120,
	defaultTimeLimitSeconds: 20,
	minPoints: 1,
	maxPoints: 2000,
	defaultPoints: 100
} as const;

export interface QuizOptionInput {
	id?: string;
	text: string;
	isCorrect: boolean;
}

export interface QuizQuestionInput {
	id?: string;
	text: string;
	imageUrl?: string | null;
	timeLimitSeconds: number;
	points: number;
	options: QuizOptionInput[];
}

export interface QuizOptionDetail {
	id: string;
	questionId: string;
	text: string;
	position: number;
	isCorrect: boolean;
}

export interface QuizQuestionDetail {
	id: string;
	quizId: string;
	text: string;
	imageUrl?: string | null;
	position: number;
	timeLimitSeconds: number;
	points: number;
	createdAt: Date | string;
	updatedAt: Date | string;
	options: QuizOptionDetail[];
}

export interface QuizSummary {
	id: string;
	teacherId: string;
	title: string;
	description: string | null;
	status: QuizStatus;
	questionCount: number;
	createdAt: Date | string;
	updatedAt: Date | string;
}

export interface QuizDetail {
	id: string;
	teacherId: string;
	title: string;
	description: string | null;
	status: QuizStatus;
	createdAt: Date | string;
	updatedAt: Date | string;
	questions: QuizQuestionDetail[];
}
