import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../../src/lib/server/db/client.js';
import {
	questionOptions,
	questions,
	quizzes,
	teacherSessions,
	teachers
} from '../../src/lib/server/db/schema.js';
import {
	archiveTeacherQuiz,
	createTeacherQuiz,
	deleteTeacherQuiz,
	getTeacherQuiz,
	listTeacherQuizzes,
	publishTeacherQuiz,
	updateTeacherQuiz
} from '../../src/lib/server/quizzes/service.js';

interface PlatformProxy {
	env: { DB: D1Database };
	dispose: () => Promise<void>;
}

type GetPlatformProxy = (options?: {
	configPath?: string;
	persist?: boolean;
}) => Promise<PlatformProxy>;

const require = createRequire(import.meta.url);
const { getPlatformProxy } = require('wrangler') as {
	getPlatformProxy: GetPlatformProxy;
};

function migrationStatements(): string[] {
	const directory = join(process.cwd(), 'migrations');
	return readdirSync(directory)
		.filter((file) => file.endsWith('.sql'))
		.sort()
		.flatMap((file) =>
			readFileSync(join(directory, file), 'utf8')
				.split('--> statement-breakpoint')
				.map((statement) => statement.trim())
				.filter(Boolean)
		);
}

let proxy: PlatformProxy;
let db: Database;

const teacherAId = 'teacher-a';
const teacherBId = 'teacher-b';

beforeAll(async () => {
	proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: false });
	for (const statement of migrationStatements()) {
		await proxy.env.DB.prepare(statement).run();
	}
	db = createDb(proxy.env.DB);
});

afterAll(async () => {
	await proxy.dispose();
});

beforeEach(async () => {
	await db.delete(questionOptions);
	await db.delete(questions);
	await db.delete(quizzes);
	await db.delete(teacherSessions);
	await db.delete(teachers);

	const now = new Date('2026-10-30T12:00:00.000Z');
	await db.insert(teachers).values([
		{
			id: teacherAId,
			email: 'ada@example.com',
			passwordHash: 'hash-a',
			displayName: 'Ada',
			createdAt: now,
			updatedAt: now
		},
		{
			id: teacherBId,
			email: 'grace@example.com',
			passwordHash: 'hash-b',
			displayName: 'Grace',
			createdAt: now,
			updatedAt: now
		}
	]);
});

describe('quiz authoring service and ownership', () => {
	it('creates, updates, reorders, and lists a teacher quiz', async () => {
		const created = await createTeacherQuiz(db, teacherAId, {
			title: 'Science Basics',
			description: 'Quick check',
			questions: [
				{
					text: 'Planet closest to the Sun?',
					imageUrl: '/api/images/sample-mercury',
					timeLimitSeconds: 20,
					points: 100,
					options: [
						{ text: 'Mercury', isCorrect: true },
						{ text: 'Venus', isCorrect: false }
					]
				},
				{
					text: 'Chemical symbol for water?',
					timeLimitSeconds: 15,
					points: 150,
					options: [
						{ text: 'CO2', isCorrect: false },
						{ text: 'H2O', isCorrect: true },
						{ text: 'O2', isCorrect: false }
					]
				}
			]
		});

		expect(created.status).toBe('draft');
		expect(created.questions).toHaveLength(2);
		expect(created.questions[0]?.position).toBe(0);
		expect(created.questions[0]?.imageUrl).toBe('/api/images/sample-mercury');
		expect(created.questions[1]?.position).toBe(1);
		expect(created.questions[1]?.imageUrl).toBeNull();

		// Reorder questions (swap Q2 to index 0, Q1 to index 1) and update title
		const reordered = await updateTeacherQuiz(db, teacherAId, created.id, {
			title: 'Science Basics Updated',
			description: null,
			questions: [
				{
					text: 'Chemical symbol for water?',
					timeLimitSeconds: 15,
					points: 200,
					options: [
						{ text: 'H2O', isCorrect: true },
						{ text: 'CO2', isCorrect: false }
					]
				},
				{
					text: 'Planet closest to the Sun?',
					timeLimitSeconds: 25,
					points: 100,
					options: [
						{ text: 'Venus', isCorrect: false },
						{ text: 'Mercury', isCorrect: true }
					]
				}
			]
		});

		expect(reordered.title).toBe('Science Basics Updated');
		expect(reordered.description).toBeNull();
		expect(reordered.questions).toHaveLength(2);
		expect(reordered.questions[0]?.text).toBe('Chemical symbol for water?');
		expect(reordered.questions[0]?.position).toBe(0);
		expect(reordered.questions[0]?.points).toBe(200);
		expect(reordered.questions[1]?.text).toBe('Planet closest to the Sun?');
		expect(reordered.questions[1]?.position).toBe(1);

		const allOptions = await db.select().from(questionOptions);
		expect(allOptions).toHaveLength(4);

		const list = await listTeacherQuizzes(db, teacherAId);
		expect(list).toHaveLength(1);
		expect(list[0]?.questionCount).toBe(2);
	});

	it('rejects publishing a draft quiz with no questions, and publishes once valid', async () => {
		const draft = await createTeacherQuiz(db, teacherAId, {
			title: 'Empty Draft',
			description: null,
			questions: []
		});

		await expect(publishTeacherQuiz(db, teacherAId, draft.id)).rejects.toMatchObject({
			status: 400,
			code: 'invalid_quiz_for_publish'
		});

		await updateTeacherQuiz(db, teacherAId, draft.id, {
			title: 'Ready Quiz',
			description: 'Now has a question',
			questions: [
				{
					text: '2 + 2 = ?',
					timeLimitSeconds: 10,
					points: 100,
					options: [
						{ text: '3', isCorrect: false },
						{ text: '4', isCorrect: true }
					]
				}
			]
		});

		const published = await publishTeacherQuiz(db, teacherAId, draft.id);
		expect(published.status).toBe('published');

		// Cannot strip all questions from an already-published quiz
		await expect(
			updateTeacherQuiz(db, teacherAId, draft.id, {
				title: 'Ready Quiz',
				description: null,
				questions: []
			})
		).rejects.toMatchObject({
			status: 400,
			code: 'invalid_quiz_for_publish'
		});
	});

	it('archives a quiz and blocks further edits or publishing', async () => {
		const quiz = await createTeacherQuiz(db, teacherAId, {
			title: 'History Quiz',
			description: null,
			questions: [
				{
					text: 'First programmable computer?',
					timeLimitSeconds: 20,
					points: 100,
					options: [
						{ text: 'Z3', isCorrect: true },
						{ text: 'ENIAC', isCorrect: false }
					]
				}
			]
		});

		const archived = await archiveTeacherQuiz(db, teacherAId, quiz.id);
		expect(archived.status).toBe('archived');

		await expect(
			updateTeacherQuiz(db, teacherAId, quiz.id, {
				title: 'Mutated Title',
				description: null,
				questions: []
			})
		).rejects.toMatchObject({
			status: 409,
			code: 'quiz_archived'
		});

		await expect(publishTeacherQuiz(db, teacherAId, quiz.id)).rejects.toMatchObject({
			status: 409,
			code: 'quiz_archived'
		});
	});

	it('enforces ownership across all quiz operations', async () => {
		const quiz = await createTeacherQuiz(db, teacherAId, {
			title: 'Ada Private Quiz',
			description: 'Owned by Ada',
			questions: [
				{
					text: 'Question 1',
					timeLimitSeconds: 20,
					points: 100,
					options: [
						{ text: 'A', isCorrect: true },
						{ text: 'B', isCorrect: false }
					]
				}
			]
		});

		expect(await listTeacherQuizzes(db, teacherBId)).toEqual([]);

		await expect(getTeacherQuiz(db, teacherBId, quiz.id)).rejects.toMatchObject({
			status: 404,
			code: 'quiz_not_found'
		});

		await expect(
			updateTeacherQuiz(db, teacherBId, quiz.id, {
				title: 'Hijacked',
				description: null,
				questions: []
			})
		).rejects.toMatchObject({
			status: 404,
			code: 'quiz_not_found'
		});

		await expect(publishTeacherQuiz(db, teacherBId, quiz.id)).rejects.toMatchObject({
			status: 404,
			code: 'quiz_not_found'
		});

		await expect(archiveTeacherQuiz(db, teacherBId, quiz.id)).rejects.toMatchObject({
			status: 404,
			code: 'quiz_not_found'
		});

		await expect(deleteTeacherQuiz(db, teacherBId, quiz.id)).rejects.toMatchObject({
			status: 404,
			code: 'quiz_not_found'
		});

		// Verify Ada's quiz is untouched, and Ada can delete it
		const intact = await getTeacherQuiz(db, teacherAId, quiz.id);
		expect(intact.title).toBe('Ada Private Quiz');

		await deleteTeacherQuiz(db, teacherAId, quiz.id);
		await expect(getTeacherQuiz(db, teacherAId, quiz.id)).rejects.toMatchObject({
			status: 404,
			code: 'quiz_not_found'
		});
	});
});
