import { and, asc, count, desc, eq, inArray, like, or } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '../db/client.js';
import {
	questionOptions,
	questions,
	quizzes,
	teachers,
	type NewQuestionOptionRow,
	type NewQuestionRow,
	type NewQuizRow,
	type QuestionOptionRow,
	type QuestionRow,
	type QuizRow,
	type QuizStatus
} from '../db/schema.js';
import type {
	LibraryQuizDetail,
	LibraryQuizSummary,
	QuizDetail,
	QuizOptionDetail,
	QuizQuestionDetail,
	QuizSummary
} from '#lib/shared/quiz.js';

export interface QuizQuestionWrite {
	question: NewQuestionRow;
	options: NewQuestionOptionRow[];
}

function toOptionDetail(row: QuestionOptionRow): QuizOptionDetail {
	return {
		id: row.id,
		questionId: row.questionId,
		text: row.text,
		position: row.position,
		isCorrect: row.isCorrect
	};
}

function toQuestionDetail(row: QuestionRow, optionRows: QuestionOptionRow[]): QuizQuestionDetail {
	return {
		id: row.id,
		quizId: row.quizId,
		text: row.text,
		imageUrl: row.imageUrl ?? null,
		position: row.position,
		timeLimitSeconds: row.timeLimitSeconds,
		points: row.points,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		options: optionRows.map(toOptionDetail)
	};
}

export async function listQuizzesByTeacher(
	db: Database,
	teacherId: string
): Promise<QuizSummary[]> {
	const rows = await db
		.select({
			id: quizzes.id,
			teacherId: quizzes.teacherId,
			title: quizzes.title,
			description: quizzes.description,
			status: quizzes.status,
			isPublic: quizzes.isPublic,
			createdAt: quizzes.createdAt,
			updatedAt: quizzes.updatedAt,
			questionCount: count(questions.id)
		})
		.from(quizzes)
		.leftJoin(questions, eq(questions.quizId, quizzes.id))
		.where(eq(quizzes.teacherId, teacherId))
		.groupBy(quizzes.id)
		.orderBy(desc(quizzes.updatedAt), desc(quizzes.createdAt));

	return rows.map((row) => ({
		id: row.id,
		teacherId: row.teacherId,
		title: row.title,
		description: row.description,
		status: row.status,
		isPublic: Boolean(row.isPublic),
		questionCount: Number(row.questionCount),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	}));
}

export async function findQuizRowForTeacher(
	db: Database,
	quizId: string,
	teacherId: string
): Promise<QuizRow | null> {
	const [row] = await db
		.select()
		.from(quizzes)
		.where(and(eq(quizzes.id, quizId), eq(quizzes.teacherId, teacherId)))
		.limit(1);

	return row ?? null;
}

export async function findQuizDetailForTeacher(
	db: Database,
	quizId: string,
	teacherId: string
): Promise<QuizDetail | null> {
	const quiz = await findQuizRowForTeacher(db, quizId, teacherId);
	if (!quiz) return null;

	const questionRows = await db
		.select()
		.from(questions)
		.where(eq(questions.quizId, quiz.id))
		.orderBy(asc(questions.position));

	const questionIds = questionRows.map((row) => row.id);
	const optionRows =
		questionIds.length > 0
			? await db
					.select()
					.from(questionOptions)
					.where(inArray(questionOptions.questionId, questionIds))
					.orderBy(asc(questionOptions.position))
			: [];

	const optionsByQuestion = new Map<string, QuestionOptionRow[]>();
	for (const option of optionRows) {
		const bucket = optionsByQuestion.get(option.questionId);
		if (bucket) {
			bucket.push(option);
		} else {
			optionsByQuestion.set(option.questionId, [option]);
		}
	}

	return {
		id: quiz.id,
		teacherId: quiz.teacherId,
		title: quiz.title,
		description: quiz.description,
		status: quiz.status,
		isPublic: Boolean(quiz.isPublic),
		createdAt: quiz.createdAt,
		updatedAt: quiz.updatedAt,
		questions: questionRows.map((question) =>
			toQuestionDetail(question, optionsByQuestion.get(question.id) ?? [])
		)
	};
}

export async function insertQuizWithQuestions(
	db: Database,
	quiz: NewQuizRow,
	questionWrites: QuizQuestionWrite[]
): Promise<void> {
	const statements: BatchItem<'sqlite'>[] = [db.insert(quizzes).values(quiz)];

	for (const item of questionWrites) {
		statements.push(db.insert(questions).values(item.question));
		if (item.options.length > 0) {
			statements.push(db.insert(questionOptions).values(item.options));
		}
	}

	const [first, ...rest] = statements;
	if (first) {
		await db.batch([first, ...rest]);
	}
}

export async function replaceQuizAndQuestions(
	db: Database,
	params: {
		quizId: string;
		teacherId: string;
		title: string;
		description: string | null;
		isPublic?: boolean;
		updatedAt: Date;
		existingQuestionIds: string[];
		questionWrites: QuizQuestionWrite[];
	}
): Promise<void> {
	const setFields: {
		title: string;
		description: string | null;
		updatedAt: Date;
		isPublic?: boolean;
	} = {
		title: params.title,
		description: params.description,
		updatedAt: params.updatedAt
	};

	if (params.isPublic !== undefined) {
		setFields.isPublic = params.isPublic;
	}

	const statements: BatchItem<'sqlite'>[] = [
		db
			.update(quizzes)
			.set(setFields)
			.where(and(eq(quizzes.id, params.quizId), eq(quizzes.teacherId, params.teacherId)))
	];

	if (params.existingQuestionIds.length > 0) {
		statements.push(
			db
				.delete(questionOptions)
				.where(inArray(questionOptions.questionId, params.existingQuestionIds))
		);
	}

	statements.push(db.delete(questions).where(eq(questions.quizId, params.quizId)));

	for (const item of params.questionWrites) {
		statements.push(db.insert(questions).values(item.question));
		if (item.options.length > 0) {
			statements.push(db.insert(questionOptions).values(item.options));
		}
	}

	const [first, ...rest] = statements;
	if (first) {
		await db.batch([first, ...rest]);
	}
}

export async function updateQuizStatusForTeacher(
	db: Database,
	params: {
		quizId: string;
		teacherId: string;
		status: QuizStatus;
		updatedAt: Date;
	}
): Promise<void> {
	const setFields: { status: QuizStatus; updatedAt: Date; isPublic?: boolean } = {
		status: params.status,
		updatedAt: params.updatedAt
	};
	if (params.status === 'archived') {
		setFields.isPublic = false;
	}

	await db
		.update(quizzes)
		.set(setFields)
		.where(and(eq(quizzes.id, params.quizId), eq(quizzes.teacherId, params.teacherId)));
}

export async function updateQuizShareForTeacher(
	db: Database,
	params: {
		quizId: string;
		teacherId: string;
		isPublic: boolean;
		updatedAt: Date;
	}
): Promise<void> {
	await db
		.update(quizzes)
		.set({
			isPublic: params.isPublic,
			updatedAt: params.updatedAt
		})
		.where(and(eq(quizzes.id, params.quizId), eq(quizzes.teacherId, params.teacherId)));
}

export async function listPublicQuizzes(
	db: Database,
	search?: string
): Promise<LibraryQuizSummary[]> {
	const trimmedSearch = search?.trim();
	const baseCondition = and(eq(quizzes.isPublic, true), eq(quizzes.status, 'published'));
	const whereClause = trimmedSearch
		? and(
				baseCondition,
				or(
					like(quizzes.title, `%${trimmedSearch}%`),
					like(quizzes.description, `%${trimmedSearch}%`),
					like(teachers.displayName, `%${trimmedSearch}%`)
				)
			)
		: baseCondition;

	const rows = await db
		.select({
			id: quizzes.id,
			teacherId: quizzes.teacherId,
			title: quizzes.title,
			description: quizzes.description,
			createdAt: quizzes.createdAt,
			updatedAt: quizzes.updatedAt,
			authorName: teachers.displayName,
			questionCount: count(questions.id)
		})
		.from(quizzes)
		.innerJoin(teachers, eq(teachers.id, quizzes.teacherId))
		.leftJoin(questions, eq(questions.quizId, quizzes.id))
		.where(whereClause)
		.groupBy(quizzes.id)
		.orderBy(desc(quizzes.updatedAt), desc(quizzes.createdAt));

	return rows.map((row) => ({
		id: row.id,
		teacherId: row.teacherId,
		title: row.title,
		description: row.description,
		questionCount: Number(row.questionCount),
		authorName: row.authorName,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	}));
}

export async function findPublicQuizDetail(
	db: Database,
	quizId: string
): Promise<LibraryQuizDetail | null> {
	const [quizRow] = await db
		.select({
			id: quizzes.id,
			teacherId: quizzes.teacherId,
			title: quizzes.title,
			description: quizzes.description,
			status: quizzes.status,
			isPublic: quizzes.isPublic,
			createdAt: quizzes.createdAt,
			updatedAt: quizzes.updatedAt,
			authorName: teachers.displayName
		})
		.from(quizzes)
		.innerJoin(teachers, eq(teachers.id, quizzes.teacherId))
		.where(and(eq(quizzes.id, quizId), eq(quizzes.isPublic, true), eq(quizzes.status, 'published')))
		.limit(1);

	if (!quizRow) return null;

	const questionRows = await db
		.select()
		.from(questions)
		.where(eq(questions.quizId, quizRow.id))
		.orderBy(asc(questions.position));

	const questionIds = questionRows.map((row) => row.id);
	const optionRows =
		questionIds.length > 0
			? await db
					.select()
					.from(questionOptions)
					.where(inArray(questionOptions.questionId, questionIds))
					.orderBy(asc(questionOptions.position))
			: [];

	const optionsByQuestion = new Map<string, QuestionOptionRow[]>();
	for (const option of optionRows) {
		const bucket = optionsByQuestion.get(option.questionId);
		if (bucket) {
			bucket.push(option);
		} else {
			optionsByQuestion.set(option.questionId, [option]);
		}
	}

	return {
		id: quizRow.id,
		teacherId: quizRow.teacherId,
		title: quizRow.title,
		description: quizRow.description,
		status: quizRow.status,
		isPublic: Boolean(quizRow.isPublic),
		createdAt: quizRow.createdAt,
		updatedAt: quizRow.updatedAt,
		authorName: quizRow.authorName,
		questions: questionRows.map((question) =>
			toQuestionDetail(question, optionsByQuestion.get(question.id) ?? [])
		)
	};
}

export async function deleteQuizForTeacher(
	db: Database,
	params: {
		quizId: string;
		teacherId: string;
		existingQuestionIds: string[];
	}
): Promise<void> {
	const statements: BatchItem<'sqlite'>[] = [];

	if (params.existingQuestionIds.length > 0) {
		statements.push(
			db
				.delete(questionOptions)
				.where(inArray(questionOptions.questionId, params.existingQuestionIds))
		);
	}

	statements.push(
		db.delete(questions).where(eq(questions.quizId, params.quizId)),
		db
			.delete(quizzes)
			.where(and(eq(quizzes.id, params.quizId), eq(quizzes.teacherId, params.teacherId)))
	);

	const [first, ...rest] = statements;
	if (first) {
		await db.batch([first, ...rest]);
	}
}
