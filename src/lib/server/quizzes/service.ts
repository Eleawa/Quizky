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
	findPublicQuizDetail,
	findQuizDetailForTeacher,
	insertQuizWithQuestions,
	listPublicQuizzes,
	listQuizzesByTeacher,
	replaceQuizAndQuestions,
	updateQuizShareForTeacher,
	updateQuizStatusForTeacher,
	type QuizQuestionWrite
} from './repository.js';
import type {
	LibraryQuizDetail,
	LibraryQuizSummary,
	QuizDetail,
	QuizSummary
} from '#lib/shared/quiz.js';

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
			isPublic: false,
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

	if (parsed.isPublic === true && existing.status !== 'published') {
		throw new ApiError(
			400,
			'invalid_quiz_share',
			'Only published quizzes can be shared to the library.'
		);
	}

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
		isPublic: parsed.isPublic,
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

export async function shareTeacherQuiz(
	db: Database,
	teacherId: string,
	quizId: string,
	isPublic: boolean,
	now: Date = new Date()
): Promise<QuizDetail> {
	const existing = await findQuizDetailForTeacher(db, quizId, teacherId);
	if (!existing) throw quizNotFound();

	if (existing.status === 'archived') {
		throw new ApiError(409, 'quiz_archived', 'Archived quizzes cannot be shared.');
	}

	if (isPublic && existing.status !== 'published') {
		throw new ApiError(
			400,
			'invalid_quiz_share',
			'Only published quizzes can be shared to the library.'
		);
	}

	await updateQuizShareForTeacher(db, {
		quizId,
		teacherId,
		isPublic,
		updatedAt: now
	});

	return getTeacherQuiz(db, teacherId, quizId);
}

export async function listLibraryQuizzes(
	db: Database,
	search?: string
): Promise<LibraryQuizSummary[]> {
	return listPublicQuizzes(db, search);
}

export async function getLibraryQuiz(db: Database, quizId: string): Promise<LibraryQuizDetail> {
	const quiz = await findPublicQuizDetail(db, quizId);
	if (!quiz) {
		throw new ApiError(404, 'library_quiz_not_found', 'Shared quiz not found.');
	}
	return quiz;
}

export async function cloneLibraryQuiz(
	db: Database,
	targetTeacherId: string,
	quizId: string,
	now: Date = new Date()
): Promise<QuizDetail> {
	const sourceQuiz = await findPublicQuizDetail(db, quizId);
	if (!sourceQuiz) {
		throw new ApiError(404, 'library_quiz_not_found', 'Shared quiz not found.');
	}

	const clonedQuizId = crypto.randomUUID();
	const baseTitle = `${sourceQuiz.title} (Copy)`;
	const title = baseTitle.length > 120 ? baseTitle.slice(0, 117).trimEnd() + '...' : baseTitle;

	const questionWrites: QuizQuestionWrite[] = sourceQuiz.questions.map(
		(question, questionIndex) => {
			const newQuestionId = crypto.randomUUID();
			return {
				question: {
					id: newQuestionId,
					quizId: clonedQuizId,
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
					questionId: newQuestionId,
					text: option.text,
					position: optionIndex,
					isCorrect: option.isCorrect
				}))
			};
		}
	);

	await insertQuizWithQuestions(
		db,
		{
			id: clonedQuizId,
			teacherId: targetTeacherId,
			title,
			description: sourceQuiz.description,
			status: 'draft',
			isPublic: false,
			createdAt: now,
			updatedAt: now
		},
		questionWrites
	);

	return getTeacherQuiz(db, targetTeacherId, clonedQuizId);
}
