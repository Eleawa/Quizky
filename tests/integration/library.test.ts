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
	cloneLibraryQuiz,
	createTeacherQuiz,
	getLibraryQuiz,
	getTeacherQuiz,
	listLibraryQuizzes,
	publishTeacherQuiz,
	shareTeacherQuiz,
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
		.toSorted()
		.flatMap((file) =>
			readFileSync(join(directory, file), 'utf8')
				.split('--> statement-breakpoint')
				.map((statement) => statement.trim())
				.filter(Boolean)
		);
}

let proxy: PlatformProxy;
let db: Database;

const teacherAId = 'teacher-ada';
const teacherBId = 'teacher-grace';

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

	const now = new Date('2026-11-01T10:00:00.000Z');
	await db.insert(teachers).values([
		{
			id: teacherAId,
			email: 'ada@example.com',
			passwordHash: 'hash-ada',
			displayName: 'Ada Lovelace',
			createdAt: now,
			updatedAt: now
		},
		{
			id: teacherBId,
			email: 'grace@example.com',
			passwordHash: 'hash-grace',
			displayName: 'Grace Hopper',
			createdAt: now,
			updatedAt: now
		}
	]);
});

describe('Community Quiz Library service', () => {
	it('enforces that only published quizzes can be shared to the library', async () => {
		const quiz = await createTeacherQuiz(db, teacherAId, {
			title: 'Draft Science Quiz',
			description: 'Work in progress',
			questions: [
				{
					text: 'What is H2O?',
					timeLimitSeconds: 20,
					points: 100,
					options: [
						{ text: 'Water', isCorrect: true },
						{ text: 'Hydrogen', isCorrect: false }
					]
				}
			]
		});

		expect(quiz.isPublic).toBe(false);

		// Trying to share a draft directly must throw an error
		await expect(shareTeacherQuiz(db, teacherAId, quiz.id, true)).rejects.toThrow(
			'Only published quizzes can be shared to the library.'
		);

		// Trying to update draft with isPublic: true must throw an error
		await expect(
			updateTeacherQuiz(db, teacherAId, quiz.id, {
				title: quiz.title,
				description: quiz.description,
				isPublic: true,
				questions: [
					{
						text: 'What is H2O?',
						timeLimitSeconds: 20,
						points: 100,
						options: [
							{ text: 'Water', isCorrect: true },
							{ text: 'Hydrogen', isCorrect: false }
						]
					}
				]
			})
		).rejects.toThrow('Only published quizzes can be shared to the library.');

		// Now publish it
		await publishTeacherQuiz(db, teacherAId, quiz.id);

		// Now sharing must succeed
		const shared = await shareTeacherQuiz(db, teacherAId, quiz.id, true);
		expect(shared.isPublic).toBe(true);

		// Unsharing should also succeed
		const unshared = await shareTeacherQuiz(db, teacherAId, quiz.id, false);
		expect(unshared.isPublic).toBe(false);
	});

	it('lists shared quizzes and supports search filtering', async () => {
		const quiz1 = await createTeacherQuiz(db, teacherAId, {
			title: 'World Capitals',
			description: 'European geography trivia',
			questions: [
				{
					text: 'Capital of France?',
					timeLimitSeconds: 15,
					points: 100,
					options: [
						{ text: 'Paris', isCorrect: true },
						{ text: 'Lyon', isCorrect: false }
					]
				}
			]
		});
		await publishTeacherQuiz(db, teacherAId, quiz1.id);
		await shareTeacherQuiz(db, teacherAId, quiz1.id, true);

		const quiz2 = await createTeacherQuiz(db, teacherBId, {
			title: 'Intro to Algorithms',
			description: 'Binary search and sorting',
			questions: [
				{
					text: 'Worst-case time of binary search?',
					timeLimitSeconds: 30,
					points: 200,
					options: [
						{ text: 'O(log n)', isCorrect: true },
						{ text: 'O(n)', isCorrect: false }
					]
				}
			]
		});
		await publishTeacherQuiz(db, teacherBId, quiz2.id);
		// quiz2 is not shared yet

		let library = await listLibraryQuizzes(db);
		expect(library).toHaveLength(1);
		expect(library[0]?.title).toBe('World Capitals');
		expect(library[0]?.authorName).toBe('Ada Lovelace');
		expect(library[0]?.questionCount).toBe(1);

		// Now share quiz2
		await shareTeacherQuiz(db, teacherBId, quiz2.id, true);
		library = await listLibraryQuizzes(db);
		expect(library).toHaveLength(2);

		// Search by keyword in title
		const searchCapitals = await listLibraryQuizzes(db, 'Capitals');
		expect(searchCapitals).toHaveLength(1);
		expect(searchCapitals[0]?.id).toBe(quiz1.id);

		// Search by teacher author name
		const searchGrace = await listLibraryQuizzes(db, 'Grace');
		expect(searchGrace).toHaveLength(1);
		expect(searchGrace[0]?.id).toBe(quiz2.id);

		// Search with no matches
		const searchNone = await listLibraryQuizzes(db, 'Astronomy');
		expect(searchNone).toHaveLength(0);
	});

	it('allows previewing a shared quiz and cloning it into another teacher account', async () => {
		const originalQuiz = await createTeacherQuiz(db, teacherAId, {
			title: 'Photosynthesis Fundamentals',
			description: 'Biology 101 unit review',
			questions: [
				{
					text: 'What gas do plants absorb during photosynthesis?',
					imageUrl: '/api/images/sample-leaf',
					timeLimitSeconds: 25,
					points: 150,
					options: [
						{ text: 'Carbon Dioxide', isCorrect: true },
						{ text: 'Oxygen', isCorrect: false },
						{ text: 'Nitrogen', isCorrect: false }
					]
				}
			]
		});
		await publishTeacherQuiz(db, teacherAId, originalQuiz.id);
		await shareTeacherQuiz(db, teacherAId, originalQuiz.id, true);

		// Teacher B previews the quiz
		const preview = await getLibraryQuiz(db, originalQuiz.id);
		expect(preview.title).toBe('Photosynthesis Fundamentals');
		expect(preview.authorName).toBe('Ada Lovelace');
		expect(preview.questions).toHaveLength(1);
		expect(preview.questions[0]?.options).toHaveLength(3);
		expect(preview.questions[0]?.imageUrl).toBe('/api/images/sample-leaf');

		// Teacher B clones the quiz into their account
		const cloned = await cloneLibraryQuiz(db, teacherBId, originalQuiz.id);
		expect(cloned.id).not.toBe(originalQuiz.id);
		expect(cloned.teacherId).toBe(teacherBId);
		expect(cloned.title).toBe('Photosynthesis Fundamentals (Copy)');
		expect(cloned.status).toBe('draft');
		expect(cloned.isPublic).toBe(false);
		expect(cloned.questions).toHaveLength(1);
		expect(cloned.questions[0]?.id).not.toBe(originalQuiz.questions[0]?.id);
		expect(cloned.questions[0]?.text).toBe('What gas do plants absorb during photosynthesis?');
		expect(cloned.questions[0]?.imageUrl).toBe('/api/images/sample-leaf');
		expect(cloned.questions[0]?.options).toHaveLength(3);

		// Teacher B can now edit their own cloned copy without affecting Ada's original
		const updatedCloned = await updateTeacherQuiz(db, teacherBId, cloned.id, {
			title: 'Custom Photosynthesis Quiz',
			description: 'Adapted for my class',
			questions: [
				{
					text: 'Adapted question?',
					timeLimitSeconds: 15,
					points: 50,
					options: [
						{ text: 'Yes', isCorrect: true },
						{ text: 'No', isCorrect: false }
					]
				}
			]
		});
		expect(updatedCloned.title).toBe('Custom Photosynthesis Quiz');

		// Original remains unchanged
		const checkOriginal = await getTeacherQuiz(db, teacherAId, originalQuiz.id);
		expect(checkOriginal.title).toBe('Photosynthesis Fundamentals');
		expect(checkOriginal.questions[0]?.text).toBe(
			'What gas do plants absorb during photosynthesis?'
		);
	});

	it('unshares quizzes automatically when archived', async () => {
		const quiz = await createTeacherQuiz(db, teacherAId, {
			title: 'Physics Mechanics',
			description: 'Force and motion',
			questions: [
				{
					text: 'Force equals mass times what?',
					timeLimitSeconds: 20,
					points: 100,
					options: [
						{ text: 'Acceleration', isCorrect: true },
						{ text: 'Velocity', isCorrect: false }
					]
				}
			]
		});
		await publishTeacherQuiz(db, teacherAId, quiz.id);
		await shareTeacherQuiz(db, teacherAId, quiz.id, true);

		let library = await listLibraryQuizzes(db);
		expect(library.some((q) => q.id === quiz.id)).toBe(true);

		// Archive the quiz
		await archiveTeacherQuiz(db, teacherAId, quiz.id);

		// Should no longer appear in library
		library = await listLibraryQuizzes(db);
		expect(library.some((q) => q.id === quiz.id)).toBe(false);

		// Should reject sharing archived quiz
		await expect(shareTeacherQuiz(db, teacherAId, quiz.id, true)).rejects.toThrow(
			'Archived quizzes cannot be shared.'
		);
	});
});
