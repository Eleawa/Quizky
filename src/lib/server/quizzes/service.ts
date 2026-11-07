import { ApiError } from '../api/errors.js';
import type { Database } from '../db/client.js';
import {
	createQuizSchema,
	updateQuizSchema,
	validateQuizForPublish,
	type CreateQuizInput,
	type UpdateQuizInput,
	type ValidatedQuestionInput
} from '../validation/quiz.js';
import {
	deleteQuizForTeacher,
	findQuizDetailForTeacher,
	insertQuizWithQuestions,
	listQuizzesByTeacher,
	replaceQuizAndQuestions,
	updateQuizStatusForTeacher,
	type QuizQuestionWrite
} from './repository.js';
import type { QuizDetail, QuizSummary } from '#lib/shared/quiz.js';

function quizNotFound(): ApiError {
	return new ApiError(404, 'quiz_not_found', 'Quiz not found.');
}

function buildQuestionWrites(
	quizId: string,
	inputs: ValidatedQuestionInput[],
	now: Date
): QuizQuestionWrite[] {
	return inputs.map((question, questionIndex) => {
		const questionId = crypto.randomUUID();
		return {
			question: {
				id: questionId,
				quizId,
				text: question.text,
				imageUrl: question.imageUrl ?? null,
				position: questionIndex,
				timeLimitSeconds: question.timeLimitSeconds,
				points: question.points,
				createdAt: now,
				updatedAt: now
			},
			options: question.options.map((option, optionIndex) => ({
				id: crypto.randomUUID(),
				questionId,
				text: option.text,
				position: optionIndex,
				isCorrect: option.isCorrect
			}))
		};
	});
}

export async function listTeacherQuizzes(db: Database, teacherId: string): Promise<QuizSummary[]> {
	return listQuizzesByTeacher(db, teacherId);
}

export async function getTeacherQuiz(
	db: Database,
	teacherId: string,
	quizId: string
): Promise<QuizDetail> {
	const quiz = await findQuizDetailForTeacher(db, quizId, teacherId);
	if (!quiz) throw quizNotFound();
	return quiz;
}

export async function createTeacherQuiz(
	db: Database,
	teacherId: string,
	input: CreateQuizInput,
	now: Date = new Date()
): Promise<QuizDetail> {
	const parsed = createQuizSchema.parse(input);
	const quizId = crypto.randomUUID();
	const questionWrites = buildQuestionWrites(quizId, parsed.questions, now);

	await insertQuizWithQuestions(
		db,
		{
			id: quizId,
			teacherId,
			title: parsed.title,
			description: parsed.description,
			status: 'draft',
			createdAt: now,
			updatedAt: now
		},
		questionWrites
	);

	return getTeacherQuiz(db, teacherId, quizId);
}

export async function updateTeacherQuiz(
	db: Database,
	teacherId: string,
	quizId: string,
	input: UpdateQuizInput,
	now: Date = new Date()
): Promise<QuizDetail> {
	const existing = await findQuizDetailForTeacher(db, quizId, teacherId);
	if (!existing) throw quizNotFound();

	if (existing.status === 'archived') {
		throw new ApiError(409, 'quiz_archived', 'Archived quizzes cannot be edited.');
	}

	const parsed = updateQuizSchema.parse(input);

	if (existing.status === 'published') {
		const check = validateQuizForPublish({
			status: existing.status,
			title: parsed.title,
			description: parsed.description,
			questions: parsed.questions
		});
		if (!check.valid) {
			throw new ApiError(
				400,
				'invalid_quiz_for_publish',
				check.message ?? 'Published quizzes must keep at least one valid question.',
				check.fields
			);
		}
	}

	const questionWrites = buildQuestionWrites(quizId, parsed.questions, now);

	await replaceQuizAndQuestions(db, {
		quizId,
		teacherId,
		title: parsed.title,
		description: parsed.description,
		updatedAt: now,
		existingQuestionIds: existing.questions.map((question) => question.id),
		questionWrites
	});

	return getTeacherQuiz(db, teacherId, quizId);
}

export async function publishTeacherQuiz(
	db: Database,
	teacherId: string,
	quizId: string,
	now: Date = new Date()
): Promise<QuizDetail> {
	const existing = await findQuizDetailForTeacher(db, quizId, teacherId);
	if (!existing) throw quizNotFound();

	if (existing.status === 'archived') {
		throw new ApiError(409, 'quiz_archived', 'Archived quizzes cannot be published.');
	}

	const check = validateQuizForPublish({
		status: existing.status,
		title: existing.title,
		description: existing.description,
		questions: existing.questions.map((question) => ({
			text: question.text,
			timeLimitSeconds: question.timeLimitSeconds,
			points: question.points,
			options: question.options.map((option) => ({
				text: option.text,
				isCorrect: option.isCorrect
			}))
		}))
	});

	if (!check.valid) {
		throw new ApiError(
			400,
			'invalid_quiz_for_publish',
			check.message ?? 'Add at least one valid question before publishing.',
			check.fields
		);
	}

	if (existing.status !== 'published') {
		await updateQuizStatusForTeacher(db, {
			quizId,
			teacherId,
			status: 'published',
			updatedAt: now
		});
	}

	return getTeacherQuiz(db, teacherId, quizId);
}

export async function archiveTeacherQuiz(
	db: Database,
	teacherId: string,
	quizId: string,
	now: Date = new Date()
): Promise<QuizDetail> {
	const existing = await findQuizDetailForTeacher(db, quizId, teacherId);
	if (!existing) throw quizNotFound();

	if (existing.status !== 'archived') {
		await updateQuizStatusForTeacher(db, {
			quizId,
			teacherId,
			status: 'archived',
			updatedAt: now
		});
	}

	return getTeacherQuiz(db, teacherId, quizId);
}

export async function deleteTeacherQuiz(
	db: Database,
	teacherId: string,
	quizId: string
): Promise<void> {
	const existing = await findQuizDetailForTeacher(db, quizId, teacherId);
	if (!existing) throw quizNotFound();

	await deleteQuizForTeacher(db, {
		quizId,
		teacherId,
		existingQuestionIds: existing.questions.map((question) => question.id)
	});
}
