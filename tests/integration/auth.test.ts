import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../../src/lib/server/db/client.js';
import { teacherSessions, teachers } from '../../src/lib/server/db/schema.js';
import {
	getTeacherBySessionToken,
	loginTeacher,
	logoutTeacher,
	registerTeacher
} from '../../src/lib/server/auth/service.js';
import type { PasswordHasher } from '../../src/lib/server/auth/types.js';

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

class FakePasswordHasher implements PasswordHasher {
	verifyCalls = 0;
	lastIdentity = '';
	lastHash = '';

	async hash(identity: string, password: string): Promise<string> {
		return `fake$${identity}$${password}`;
	}

	async verify(identity: string, password: string, hash: string): Promise<boolean> {
		this.verifyCalls += 1;
		this.lastIdentity = identity;
		this.lastHash = hash;
		return hash === `fake$${identity}$${password}`;
	}
}

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
let hasher: FakePasswordHasher;

beforeAll(async () => {
	proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: false });
	for (const statement of migrationStatements()) {
		await proxy.env.DB.prepare(statement).run();
	}
	db = createDb(proxy.env.DB);
	hasher = new FakePasswordHasher();
});

afterAll(async () => {
	await proxy.dispose();
});

beforeEach(async () => {
	await db.delete(teacherSessions);
	await db.delete(teachers);
	hasher = new FakePasswordHasher();
});

describe('teacher auth', () => {
	it('registers a teacher and resolves their session', async () => {
		const result = await registerTeacher(db, hasher, {
			email: ' Teacher@Example.com ',
			password: 'correct horse battery',
			displayName: ' Ada '
		});

		expect(result.teacher.email).toBe('teacher@example.com');
		expect(result.teacher.displayName).toBe('Ada');
		expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

		const resolved = await getTeacherBySessionToken(db, result.token);
		expect(resolved?.id).toBe(result.teacher.id);

		const sessions = await db.select().from(teacherSessions);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
		expect(sessions[0]?.tokenHash).not.toBe(result.token);
	});

	it('rejects duplicate email addresses regardless of case', async () => {
		await registerTeacher(db, hasher, {
			email: 'teacher@example.com',
			password: 'correct horse battery',
			displayName: 'Ada'
		});

		await expect(
			registerTeacher(db, hasher, {
				email: 'TEACHER@example.com',
				password: 'another long password',
				displayName: 'Grace'
			})
		).rejects.toMatchObject({ status: 409, code: 'email_taken' });

		const rows = await db.select().from(teachers);
		expect(rows).toHaveLength(1);
	});

	it('logs in with the correct password and rejects a wrong one', async () => {
		const registered = await registerTeacher(db, hasher, {
			email: 'teacher@example.com',
			password: 'correct horse battery',
			displayName: 'Ada'
		});

		const loggedIn = await loginTeacher(db, hasher, {
			email: ' TEACHER@example.com ',
			password: 'correct horse battery'
		});

		expect(loggedIn.teacher.id).toBe(registered.teacher.id);
		expect(loggedIn.token).not.toBe(registered.token);

		await expect(
			loginTeacher(db, hasher, {
				email: 'teacher@example.com',
				password: 'wrong password'
			})
		).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });

		const sessions = await db.select().from(teacherSessions);
		expect(sessions).toHaveLength(2);
	});

	it('runs a dummy verification for unknown email addresses', async () => {
		await expect(
			loginTeacher(db, hasher, {
				email: 'nobody@example.com',
				password: 'correct horse battery'
			})
		).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });

		expect(hasher.verifyCalls).toBe(1);
		expect(hasher.lastIdentity).toBe('nobody@example.com');
		expect(hasher.lastHash).toMatch(/^pbkdf2_sha256\$600000\$/);
	});

	it('logs out only the current session', async () => {
		const first = await registerTeacher(db, hasher, {
			email: 'first@example.com',
			password: 'correct horse battery',
			displayName: 'First'
		});
		const second = await registerTeacher(db, hasher, {
			email: 'second@example.com',
			password: 'another long password',
			displayName: 'Second'
		});

		await logoutTeacher(db, first.token);

		expect(await getTeacherBySessionToken(db, first.token)).toBeNull();
		const secondTeacher = await getTeacherBySessionToken(db, second.token);
		expect(secondTeacher?.id).toBe(second.teacher.id);

		const sessions = await db.select().from(teacherSessions);
		expect(sessions).toHaveLength(1);
	});

	it('rejects and deletes an expired session', async () => {
		const result = await registerTeacher(db, hasher, {
			email: 'teacher@example.com',
			password: 'correct horse battery',
			displayName: 'Ada'
		});

		await db
			.update(teacherSessions)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(teacherSessions.teacherId, result.teacher.id));

		expect(await getTeacherBySessionToken(db, result.token)).toBeNull();
		const sessions = await db.select().from(teacherSessions);
		expect(sessions).toHaveLength(0);
	});

	it('rejects unknown session tokens', async () => {
		expect(await getTeacherBySessionToken(db, 'not-a-real-token')).toBeNull();
	});
});
