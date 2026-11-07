import { describe, expect, it } from 'vitest';
import {
	QUIZ_LIMITS,
	createQuizSchema,
	quizQuestionInputSchema,
	updateQuizSchema,
	validateQuizForPublish
} from '../../src/lib/server/validation/quiz.js';

function validQuestion(overrides: Record<string, unknown> = {}) {
	return {
		text: 'What is the capital of France?',
		timeLimitSeconds: 20,
		points: 100,
		options: [
			{ text: 'Paris', isCorrect: true },
			{ text: 'Lyon', isCorrect: false },
			{ text: 'Marseille', isCorrect: false }
		],
		...overrides
	};
}

describe('quiz validation', () => {
	it('normalizes quiz title and empty description', () => {
		const parsed = createQuizSchema.parse({
			title: '  European Capitals  ',
			description: '   '
		});

		expect(parsed.title).toBe('European Capitals');
		expect(parsed.description).toBeNull();
		expect(parsed.questions).toEqual([]);
	});

	it('accepts a valid question with two to six options and one correct answer', () => {
		const parsed = quizQuestionInputSchema.parse(validQuestion());

		expect(parsed.text).toBe('What is the capital of France?');
		expect(parsed.options).toHaveLength(3);
		expect(parsed.options.filter((option) => option.isCorrect)).toHaveLength(1);
	});

	it('rejects questions with fewer than two or more than six options', () => {
		const tooFew = quizQuestionInputSchema.safeParse(
			validQuestion({
				options: [{ text: 'Only one', isCorrect: true }]
			})
		);
		expect(tooFew.success).toBe(false);

		const tooMany = quizQuestionInputSchema.safeParse(
			validQuestion({
				options: Array.from({ length: QUIZ_LIMITS.maxOptions + 1 }, (_, index) => ({
					text: `Option ${index + 1}`,
					isCorrect: index === 0
				}))
			})
		);
		expect(tooMany.success).toBe(false);
	});

	it('rejects questions with zero or multiple correct options', () => {
		const noneCorrect = quizQuestionInputSchema.safeParse(
			validQuestion({
				options: [
					{ text: 'Paris', isCorrect: false },
					{ text: 'Lyon', isCorrect: false }
				]
			})
		);
		expect(noneCorrect.success).toBe(false);

		const twoCorrect = quizQuestionInputSchema.safeParse(
			validQuestion({
				options: [
					{ text: 'Paris', isCorrect: true },
					{ text: 'Lyon', isCorrect: true }
				]
			})
		);
		expect(twoCorrect.success).toBe(false);
	});

	it('enforces safe bounds on time limits and point values', () => {
		expect(
			quizQuestionInputSchema.safeParse(
				validQuestion({ timeLimitSeconds: QUIZ_LIMITS.minTimeLimitSeconds - 1 })
			).success
		).toBe(false);
		expect(
			quizQuestionInputSchema.safeParse(
				validQuestion({ timeLimitSeconds: QUIZ_LIMITS.maxTimeLimitSeconds + 1 })
			).success
		).toBe(false);
		expect(
			quizQuestionInputSchema.safeParse(validQuestion({ points: QUIZ_LIMITS.minPoints - 1 }))
				.success
		).toBe(false);
		expect(
			quizQuestionInputSchema.safeParse(validQuestion({ points: QUIZ_LIMITS.maxPoints + 1 }))
				.success
		).toBe(false);
	});

	it('allows saving a draft with zero questions via updateQuizSchema', () => {
		const parsed = updateQuizSchema.safeParse({
			title: 'Draft Quiz',
			description: 'Work in progress',
			questions: []
		});
		expect(parsed.success).toBe(true);
	});

	it('requires at least one valid question to publish a quiz', () => {
		const emptyCheck = validateQuizForPublish({
			status: 'draft',
			title: 'Empty Quiz',
			description: null,
			questions: []
		});
		expect(emptyCheck.valid).toBe(false);
		expect(emptyCheck.fields.questions).toBeDefined();

		const archivedCheck = validateQuizForPublish({
			status: 'archived',
			title: 'Archived Quiz',
			description: null,
			questions: [validQuestion()]
		});
		expect(archivedCheck.valid).toBe(false);
		expect(archivedCheck.fields.status).toBeDefined();

		const validCheck = validateQuizForPublish({
			status: 'draft',
			title: 'Ready Quiz',
			description: 'Geography',
			questions: [validQuestion()]
		});
		expect(validCheck.valid).toBe(true);
		expect(validCheck.fields).toEqual({});
	});

	it('validates and normalizes optional question image URL', () => {
		const withImage = quizQuestionInputSchema.parse(
			validQuestion({
				imageUrl: '  /api/images/abc-123  '
			})
		);
		expect(withImage.imageUrl).toBe('/api/images/abc-123');

		const withEmptyImage = quizQuestionInputSchema.parse(
			validQuestion({
				imageUrl: '   '
			})
		);
		expect(withEmptyImage.imageUrl).toBeNull();

		const withNullImage = quizQuestionInputSchema.parse(
			validQuestion({
				imageUrl: null
			})
		);
		expect(withNullImage.imageUrl).toBeNull();

		const tooLongImage = quizQuestionInputSchema.safeParse(
			validQuestion({
				imageUrl: 'https://example.com/' + 'a'.repeat(2048)
			})
		);
		expect(tooLongImage.success).toBe(false);
	});
});
