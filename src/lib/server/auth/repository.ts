import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
	teacherSessions,
	teachers,
	type NewTeacherRow,
	type NewTeacherSessionRow,
	type TeacherRow
} from '../db/schema.js';
import type { PublicTeacher } from './types.js';

export function toPublicTeacher(row: TeacherRow): PublicTeacher {
	return {
		id: row.id,
		email: row.email,
		displayName: row.displayName,
		createdAt: row.createdAt
	};
}

export async function findTeacherByEmail(db: Database, email: string): Promise<TeacherRow | null> {
	const [row] = await db.select().from(teachers).where(eq(teachers.email, email)).limit(1);
	return row ?? null;
}

export async function insertTeacher(db: Database, values: NewTeacherRow): Promise<TeacherRow> {
	const [row] = await db.insert(teachers).values(values).returning();
	if (!row) {
		throw new Error('Failed to insert teacher');
	}
	return row;
}

export async function insertSession(db: Database, values: NewTeacherSessionRow): Promise<void> {
	await db.insert(teacherSessions).values(values);
}

export interface StoredSession {
	sessionId: string;
	expiresAt: Date;
	teacher: PublicTeacher;
}

export async function findSessionByTokenHash(
	db: Database,
	tokenHash: string
): Promise<StoredSession | null> {
	const [row] = await db
		.select({
			sessionId: teacherSessions.id,
			expiresAt: teacherSessions.expiresAt,
			teacher: teachers
		})
		.from(teacherSessions)
		.innerJoin(teachers, eq(teacherSessions.teacherId, teachers.id))
		.where(eq(teacherSessions.tokenHash, tokenHash))
		.limit(1);

	if (!row) return null;
	return {
		sessionId: row.sessionId,
		expiresAt: row.expiresAt,
		teacher: toPublicTeacher(row.teacher)
	};
}

export async function deleteSessionById(db: Database, sessionId: string): Promise<void> {
	await db.delete(teacherSessions).where(eq(teacherSessions.id, sessionId));
}

export async function deleteSessionByTokenHash(db: Database, tokenHash: string): Promise<void> {
	await db.delete(teacherSessions).where(eq(teacherSessions.tokenHash, tokenHash));
}
