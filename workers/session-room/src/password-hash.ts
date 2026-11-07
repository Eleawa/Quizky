import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const ALGORITHM = 'pbkdf2_sha256';
const PASSWORD_HASH_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const KEY_BYTES = KEY_BITS / 8;
const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 2_000_000;
const MAX_PASSWORD_CHARS = 128;
const MAX_PASSWORD_BYTES = 512;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	if (!value || !BASE64URL_PATTERN.test(value)) {
		throw new Error('Invalid base64url string.');
	}
	const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
	const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	if (toBase64Url(bytes) !== value) {
		throw new Error('Non-canonical base64url encoding.');
	}
	return bytes;
}

function encodeAndValidatePassword(password: string): Uint8Array {
	if (typeof password !== 'string' || password.length === 0) {
		throw new RangeError('Password must be a non-empty string.');
	}
	if (password.length > MAX_PASSWORD_CHARS) {
		throw new RangeError(`Password must not exceed ${MAX_PASSWORD_CHARS} characters.`);
	}
	const passwordBytes = encoder.encode(password);
	if (passwordBytes.byteLength === 0 || passwordBytes.byteLength > MAX_PASSWORD_BYTES) {
		throw new RangeError(`Password UTF-8 byte length must not exceed ${MAX_PASSWORD_BYTES} bytes.`);
	}
	return passwordBytes;
}

function validateIterations(iterations: number): void {
	if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
		throw new RangeError(
			`PBKDF2 iterations must be an integer between ${MIN_ITERATIONS} and ${MAX_ITERATIONS}.`
		);
	}
}

export async function derive(
	password: string,
	salt: Uint8Array,
	iterations: number
): Promise<Uint8Array<ArrayBuffer>> {
	const passwordBytes = encodeAndValidatePassword(password);
	if (!(salt instanceof Uint8Array) || salt.byteLength !== SALT_BYTES) {
		throw new RangeError(`PBKDF2 salt must be exactly ${SALT_BYTES} bytes.`);
	}
	validateIterations(iterations);

	try {
		const derived = pbkdf2(sha256, passwordBytes, salt, {
			c: iterations,
			dkLen: KEY_BYTES
		});
		const output = new Uint8Array(KEY_BYTES);
		output.set(derived);
		derived.fill(0);
		return output;
	} finally {
		passwordBytes.fill(0);
	}
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) {
		difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	}
	return difference === 0;
}

export async function hashPassword(
	password: string,
	iterations: number = PASSWORD_HASH_ITERATIONS
): Promise<string> {
	validateIterations(iterations);
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await derive(password, salt, iterations);
	try {
		return `${ALGORITHM}$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
	} finally {
		hash.fill(0);
	}
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	encodeAndValidatePassword(password);

	if (typeof stored !== 'string' || stored.length === 0) {
		return false;
	}

	const parts = stored.split('$');
	if (parts.length !== 4) return false;

	const [algorithm, iterationsText, saltText, hashText] = parts;
	if (algorithm !== ALGORITHM || !iterationsText || !saltText || !hashText) return false;
	if (!/^\d+$/.test(iterationsText)) return false;

	const iterations = Number(iterationsText);
	if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
		return false;
	}

	let salt: Uint8Array<ArrayBuffer>;
	let expected: Uint8Array<ArrayBuffer>;
	try {
		salt = fromBase64Url(saltText);
		expected = fromBase64Url(hashText);
	} catch {
		return false;
	}

	if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) {
		return false;
	}

	// Cryptographic execution is intentionally outside the parsing try/catch
	// so runtime errors are never silently masked as an invalid password.
	const actual = await derive(password, salt, iterations);
	try {
		return constantTimeEqual(actual, expected);
	} finally {
		actual.fill(0);
	}
}

export {
	ALGORITHM,
	KEY_BITS,
	KEY_BYTES,
	MAX_ITERATIONS,
	MAX_PASSWORD_BYTES,
	MAX_PASSWORD_CHARS,
	MIN_ITERATIONS,
	PASSWORD_HASH_ITERATIONS,
	SALT_BYTES
};
