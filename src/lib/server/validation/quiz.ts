import { z } from 'zod';
import { QUIZ_LIMITS, type QuizStatus } from '#lib/shared/quiz.js';
import { fieldErrors } from './auth.js';

export { QUIZ_LIMITS };

const optionalEntityIdSchema = z.string().trim().min(1).max(64).optional();

export const quizTitleSchema = z
	.string()
	.trim()
	.min(1, 'Enter a quiz title.')
	.max(QUIZ_LIMITS.maxTitleLength, `Use at most ${QUIZ_LIMITS.maxTitleLength} characters.`);

export const quizDescriptionSchema = z
	.string()
	.trim()
	.max(
		QUIZ_LIMITS.maxDescriptionLength,
		`Use at most ${QUIZ_LIMITS.maxDescriptionLength} characters.`
	)
	.nullable()
	.optional()
	.transform((value) => {
		if (!value || value.length === 0) return null;
		return value;
	});

export const quizOptionInputSchema = z
	.object({
		id: optionalEntityIdSchema,
		text: z
			.string()
			.trim()
			.min(1, 'Enter option text.')
			.max(
				QUIZ_LIMITS.maxOptionTextLength,
				`Use at most ${QUIZ_LIMITS.maxOptionTextLength} characters.`
			),
		isCorrect: z.boolean()
	})
	.strict();

export const quizQuestionInputSchema = z
	.object({
		id: optionalEntityIdSchema,
		text: z
			.string()
			.trim()
			.min(1, 'Enter the question text.')
			.max(
				QUIZ_LIMITS.maxQuestionTextLength,
				`Use at most ${QUIZ_LIMITS.maxQuestionTextLength} characters.`
			),
		imageUrl: z
			.string()
			.trim()
			.max(2048, 'Image URL must be at most 2048 characters.')
			.nullish()
			.transform((value) => {
				if (!value || value.length === 0) return null;
				return value;
			})
			.default(null),
		timeLimitSeconds: z
			.number()
			.int('Time limit must be a whole number of seconds.')
			.min(
				QUIZ_LIMITS.minTimeLimitSeconds,
				`Time limit must be between ${QUIZ_LIMITS.minTimeLimitSeconds} and ${QUIZ_LIMITS.maxTimeLimitSeconds} seconds.`
			)
			.max(
				QUIZ_LIMITS.maxTimeLimitSeconds,
				`Time limit must be between ${QUIZ_LIMITS.minTimeLimitSeconds} and ${QUIZ_LIMITS.maxTimeLimitSeconds} seconds.`
			),
		points: z
			.number()
			.int('Points must be a whole number.')
			.min(
				QUIZ_LIMITS.minPoints,
				`Points must be between ${QUIZ_LIMITS.minPoints} and ${QUIZ_LIMITS.maxPoints}.`
			)
			.max(
				QUIZ_LIMITS.maxPoints,
				`Points must be between ${QUIZ_LIMITS.minPoints} and ${QUIZ_LIMITS.maxPoints}.`
			),
		options: z
			.array(quizOptionInputSchema)
			.min(QUIZ_LIMITS.minOptions, `Include at least ${QUIZ_LIMITS.minOptions} answer options.`)
			.max(QUIZ_LIMITS.maxOptions, `Include at most ${QUIZ_LIMITS.maxOptions} answer options.`)
	})
	.strict()
	.superRefine((question, ctx) => {
		const correctCount = question.options.filter((option) => option.isCorrect).length;
		if (correctCount !== 1) {
			ctx.addIssue({
				code: 'custom',
				path: ['options'],
				message: 'Mark exactly one option as correct.'
			});
		}
	});

export const createQuizSchema = z
	.object({
		title: quizTitleSchema,
		description: quizDescriptionSchema,
		questions: z
			.array(quizQuestionInputSchema)
			.max(QUIZ_LIMITS.maxQuestions, `Include at most ${QUIZ_LIMITS.maxQuestions} questions.`)
			.optional()
			.default([])
	})
	.strict();

export const updateQuizSchema = z
	.object({
		title: quizTitleSchema,
		description: quizDescriptionSchema,
		questions: z
			.array(quizQuestionInputSchema)
			.max(QUIZ_LIMITS.maxQuestions, `Include at most ${QUIZ_LIMITS.maxQuestions} questions.`)
	})
	.strict();

export const publishableQuizSchema = z
	.object({
		title: quizTitleSchema,
		description: quizDescriptionSchema,
		questions: z
			.array(quizQuestionInputSchema)
			.min(QUIZ_LIMITS.minQuestionsToPublish, 'Add at least one question before publishing.')
			.max(QUIZ_LIMITS.maxQuestions, `Include at most ${QUIZ_LIMITS.maxQuestions} questions.`)
	})
	.strict();

export type CreateQuizInput = z.input<typeof createQuizSchema>;
export type UpdateQuizInput = z.input<typeof updateQuizSchema>;
export type ValidatedQuestionInput = z.infer<typeof quizQuestionInputSchema>;

export interface PublishValidationResult {
	valid: boolean;
	message?: string;
	fields: Record<string, string>;
}

export function validateQuizForPublish(input: {
	status: QuizStatus;
	title: string;
	description: string | null;
	questions: unknown[];
}): PublishValidationResult {
	if (input.status === 'archived') {
		return {
			valid: false,
			message: 'Archived quizzes cannot be published.',
			fields: { status: 'Archived quizzes cannot be published.' }
		};
	}

	const parsed = publishableQuizSchema.safeParse({
		title: input.title,
		description: input.description,
		questions: input.questions
	});

	if (!parsed.success) {
		const fields = fieldErrors(parsed.error);
		return {
			valid: false,
			message: fields.questions ?? fields.title ?? 'Fix the highlighted issues before publishing.',
			fields
		};
	}

	return { valid: true, fields: {} };
}
