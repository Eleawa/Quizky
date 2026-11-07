import { pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	MAX_ITERATIONS,
	MAX_PASSWORD_CHARS,
	PASSWORD_HASH_ITERATIONS,
	SALT_BYTES,
	derive,
	hashPassword,
	verifyPassword
} from '../../workers/session-room/src/password-hash.js';

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
	return Buffer.from(bytes)
		.toString('base64')
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

describe('PBKDF2-HMAC-SHA256 password hashing (RFC 8018)', () => {
	it('matches standard PBKDF2-HMAC-SHA256 test vectors (16-byte salt, 256-bit key)', async () => {
		const salt = new TextEncoder().encode('0123456789abcdef'); // 16 bytes
		expect(salt.byteLength).toBe(SALT_BYTES);

		// Vector 1: c = 1
		const dk1 = await derive('password', salt, 1);
		const node1 = pbkdf2Sync('password', salt, 1, 32, 'sha256');
		expect(toHex(dk1)).toBe(node1.toString('hex'));
		expect(toHex(dk1)).toBe('ef9d5f6add4a5d19f4a7fc92b48f2351ea95bb977642c0071ed4e4010a42cb6c');

		// Vector 2: c = 2
		const dk2 = await derive('password', salt, 2);
		const node2 = pbkdf2Sync('password', salt, 2, 32, 'sha256');
		expect(toHex(dk2)).toBe(node2.toString('hex'));

		// Vector 3: c = 4096 (cross-checked against both Node.js crypto.pbkdf2Sync and Web Crypto subtle.deriveBits)
		const dk4096 = await derive('passwordPASSWORDpassword', salt, 4096);
		const node4096 = pbkdf2Sync('passwordPASSWORDpassword', salt, 4096, 32, 'sha256');
		const webKey = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode('passwordPASSWORDpassword'),
			'PBKDF2',
			false,
			['deriveBits']
		);
		const webBits = await crypto.subtle.deriveBits(
			{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 4096 },
			webKey,
			256
		);
		expect(toHex(dk4096)).toBe(node4096.toString('hex'));
		expect(toHex(dk4096)).toBe(toHex(new Uint8Array(webBits)));
	});

	it('cross-verifies bit-for-bit against Node.js crypto.pbkdf2Sync at 600,000 iterations', async () => {
		const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
		const password = 'CorrectHorseBatteryStaple!2026';

		const actual = await derive(password, salt, PASSWORD_HASH_ITERATIONS);
		const expectedNode = pbkdf2Sync(password, salt, PASSWORD_HASH_ITERATIONS, 32, 'sha256');

		expect(toHex(actual)).toBe(expectedNode.toString('hex'));
	});

	it('maintains full bidirectional compatibility with existing pbkdf2_sha256$600000$salt$hash format', async () => {
		const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
		const password = 'ExistingTeacherPassword!99';

		// Simulate a hash stored by Web Crypto / Node crypto in the existing format
		const legacyKey = pbkdf2Sync(password, salt, PASSWORD_HASH_ITERATIONS, 32, 'sha256');
		const legacyStored = `pbkdf2_sha256$${PASSWORD_HASH_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(legacyKey)}`;

		await expect(verifyPassword(password, legacyStored)).resolves.toBe(true);
		await expect(verifyPassword('WrongPassword!99', legacyStored)).resolves.toBe(false);

		// And verify hashPassword output against Node crypto.pbkdf2Sync
		const generated = await hashPassword(password, 10_000);
		const parts = generated.split('$');
		expect(parts[0]).toBe('pbkdf2_sha256');
		expect(parts[1]).toBe('10000');
		const genSalt = Buffer.from(parts[2]!, 'base64url');
		const genKey = Buffer.from(parts[3]!, 'base64url');
		const nodeCheck = pbkdf2Sync(password, genSalt, 10_000, 32, 'sha256');
		expect(genKey.equals(nodeCheck)).toBe(true);
	});

	it('verifies correct and incorrect passwords including Unicode and boundary lengths', async () => {
		const unicodePw = 'प्रोफेसर-Quizky-🔐-2026!';
		const hashUnicode = await hashPassword(unicodePw, 2000);
		await expect(verifyPassword(unicodePw, hashUnicode)).resolves.toBe(true);
		await expect(verifyPassword('प्रोफेसर-Quizky-🔓-2026!', hashUnicode)).resolves.toBe(false);

		const maxLenPw = 'A'.repeat(MAX_PASSWORD_CHARS);
		const hashMax = await hashPassword(maxLenPw, 2000);
		await expect(verifyPassword(maxLenPw, hashMax)).resolves.toBe(true);
		await expect(verifyPassword('A'.repeat(MAX_PASSWORD_CHARS - 1) + 'B', hashMax)).resolves.toBe(
			false
		);
	});

	it('uses a fresh random 16-byte salt for every hash', async () => {
		const first = await hashPassword('same password', 1000);
		const second = await hashPassword('same password', 1000);

		expect(first).not.toBe(second);
		expect(first).toMatch(/^pbkdf2_sha256\$1000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
	});

	it('returns false for malformed stored hashes and out-of-range iterations without throwing', async () => {
		await expect(verifyPassword('password', '')).resolves.toBe(false);
		await expect(verifyPassword('password', 'not-a-hash')).resolves.toBe(false);
		await expect(verifyPassword('password', 'pbkdf2_sha256$600000$bad$bad')).resolves.toBe(false);
		await expect(
			verifyPassword(
				'password',
				'sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
			)
		).resolves.toBe(false);
		await expect(
			verifyPassword(
				'password',
				'pbkdf2_sha256$0$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
			)
		).resolves.toBe(false);
		await expect(
			verifyPassword(
				'password',
				`pbkdf2_sha256$${MAX_ITERATIONS + 1}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
			)
		).resolves.toBe(false);
		await expect(
			verifyPassword(
				'password',
				'pbkdf2_sha256$600000$AAAAAAAAAAAAAAAAAAAA+A$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
			)
		).resolves.toBe(false);
	});

	it('throws on invalid password inputs rather than silently converting errors to false', async () => {
		const validStored =
			'pbkdf2_sha256$1000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

		await expect(hashPassword('')).rejects.toThrow(RangeError);
		await expect(hashPassword('x'.repeat(MAX_PASSWORD_CHARS + 1))).rejects.toThrow(RangeError);
		await expect(verifyPassword('', validStored)).rejects.toThrow(RangeError);
		await expect(verifyPassword('x'.repeat(MAX_PASSWORD_CHARS + 1), validStored)).rejects.toThrow(
			RangeError
		);
		await expect(derive('validPassword123', new Uint8Array(8), 1000)).rejects.toThrow(RangeError);
	});

	it('defaults to 600,000 iterations, completes well under the 30s DO CPU limit, and supports concurrent calls', async () => {
		expect(PASSWORD_HASH_ITERATIONS).toBe(600_000);

		const start = performance.now();
		const hash = await hashPassword('correct horse battery staple');
		const hashDurationMs = performance.now() - start;

		expect(hash).toContain('$600000$');
		expect(hashDurationMs).toBeLessThan(5_000);

		const verifyStart = performance.now();
		const [okCorrect, okWrong] = await Promise.all([
			verifyPassword('correct horse battery staple', hash),
			verifyPassword('wrong horse battery staple', hash)
		]);
		const verifyDurationMs = performance.now() - verifyStart;

		expect(okCorrect).toBe(true);
		expect(okWrong).toBe(false);
		expect(verifyDurationMs).toBeLessThan(10_000);
	});
});
