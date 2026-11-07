import { ApiError } from '../api/errors.js';
import type { Database } from '../db/client.js';
import { normalizeEmail, type LoginInput, type RegisterInput } from '../validation/auth.js';
import {
	deleteSessionById,
	deleteSessionByTokenHash,
	findSessionByTokenHash,
	findTeacherByEmail,
	insertSession,
	insertTeacher,
	toPublicTeacher
} from './repository.js';
import { generateSessionToken, hashSessionToken, sessionExpiresAt } from './session.js';
import type { AuthResult, PasswordHasher, PublicTeacher } from './types.js';

const DUMMY_PASSWORD_HASH =
	'pbkdf2_sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MAX_TOKEN_LENGTH = 512;

function isUniqueEmailError(error: unknown): boolean {
	return error instanceof Error && /unique constraint failed: teachers\.email/i.test(error.message);
}

async function createSession(
	db: Database,
	teacherId: string,
	now: Date
): Promise<{ token: string; expiresAt: Date }> {
	const token = generateSessionToken();
	const tokenHash = await hashSessionToken(token);
	const expiresAt = sessionExpiresAt(now);
	await insertSession(db, {
		id: crypto.randomUUID(),
		teacherId,
		tokenHash,
		expiresAt,
		createdAt: now
	});
	return { token, expiresAt };
}

export async function registerTeacher(
	db: Database,
	hasher: PasswordHasher,
	input: RegisterInput,
	now: Date = new Date()
): Promise<AuthResult> {
	const email = normalizeEmail(input.email);
	const passwordHash = await hasher.hash(email, input.password);

	if (await findTeacherByEmail(db, email)) {
		throw new ApiError(409, 'email_taken', 'An account with that email already exists.', {
			email: 'An account with that email already exists.'
		});
	}

	let row;
	try {
		row = await insertTeacher(db, {
			id: crypto.randomUUID(),
			email,
			passwordHash,
			displayName: input.displayName.trim(),
			createdAt: now,
			updatedAt: now
		});
	} catch (error) {
		if (isUniqueEmailError(error)) {
			throw new ApiError(409, 'email_taken', 'An account with that email already exists.', {
				email: 'An account with that email already exists.'
			});
		}
		throw error;
	}

	const { token, expiresAt } = await createSession(db, row.id, now);
	return { teacher: toPublicTeacher(row), token, expiresAt };
}

export async function loginTeacher(
	db: Database,
	hasher: PasswordHasher,
	input: LoginInput,
	now: Date = new Date()
): Promise<AuthResult> {
	const email = normalizeEmail(input.email);
	const row = await findTeacherByEmail(db, email);
	const valid = await hasher.verify(
		email,
		input.password,
		row?.passwordHash ?? DUMMY_PASSWORD_HASH
	);

	if (!row || !valid) {
		throw new ApiError(401, 'invalid_credentials', 'Invalid email or password.');
	}

	const { token, expiresAt } = await createSession(db, row.id, now);
	return { teacher: toPublicTeacher(row), token, expiresAt };
}

export async function getTeacherBySessionToken(
	db: Database,
	token: string,
	now: Date = new Date()
): Promise<PublicTeacher | null> {
	if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;

	const session = await findSessionByTokenHash(db, await hashSessionToken(token));
	if (!session) return null;

	if (session.expiresAt.getTime() <= now.getTime()) {
		await deleteSessionById(db, session.sessionId);
		return null;
	}

	return session.teacher;
}

export async function logoutTeacher(db: Database, token: string): Promise<void> {
	if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return;
	await deleteSessionByTokenHash(db, await hashSessionToken(token));
}
