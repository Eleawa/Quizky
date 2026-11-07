import { describe, expect, it } from 'vitest';
import {
	fieldErrors,
	loginSchema,
	normalizeEmail,
	registerSchema,
	safeNextPath
} from '../../src/lib/server/validation/auth.js';

describe('auth validation', () => {
	it('normalizes registration input', () => {
		const result = registerSchema.parse({
			email: '  Teacher@Example.COM ',
			password: 'long enough password',
			displayName: '  Ada Lovelace  '
		});

		expect(result.email).toBe('teacher@example.com');
		expect(result.displayName).toBe('Ada Lovelace');
	});

	it('rejects weak passwords and short display names', () => {
		const result = registerSchema.safeParse({
			email: 'teacher@example.com',
			password: 'short',
			displayName: 'A'
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			const errors = fieldErrors(result.error);
			expect(errors.password).toBeDefined();
			expect(errors.displayName).toBeDefined();
		}
	});

	it('normalizes login email addresses', () => {
		const result = loginSchema.parse({
			email: ' Teacher@Example.COM ',
			password: 'anything'
		});

		expect(result.email).toBe('teacher@example.com');
	});

	it('normalizes email addresses directly', () => {
		expect(normalizeEmail('  Mixed@Case.COM ')).toBe('mixed@case.com');
	});

	it('only allows safe internal redirects', () => {
		expect(safeNextPath('/dashboard')).toBe('/dashboard');
		expect(safeNextPath('/dashboard?tab=quizzes')).toBe('/dashboard?tab=quizzes');
		expect(safeNextPath('https://evil.example')).toBe('/dashboard');
		expect(safeNextPath('//evil.example')).toBe('/dashboard');
		expect(safeNextPath('/api/auth/me')).toBe('/dashboard');
		expect(safeNextPath('/\\evil.example')).toBe('/dashboard');
		expect(safeNextPath(null)).toBe('/dashboard');
	});
});
