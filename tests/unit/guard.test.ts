import { describe, expect, it } from 'vitest';
import { requireAuthenticatedTeacher, requireTeacher } from '../../src/lib/server/auth/guard.js';
import type { PublicTeacher } from '../../src/lib/server/auth/types.js';

const teacher: PublicTeacher = {
	id: 'teacher-1',
	email: 'teacher@example.com',
	displayName: 'Ada',
	createdAt: new Date('2026-01-01T00:00:00.000Z')
};

describe('teacher route guard', () => {
	it('returns the signed-in teacher', () => {
		const result = requireTeacher(teacher, new URL('https://quizky.example/dashboard'));

		expect(result).toBe(teacher);
	});

	it('redirects guests to login with the requested path', () => {
		try {
			requireTeacher(null, new URL('https://quizky.example/dashboard?tab=quizzes'));
			expect.unreachable('Expected a redirect');
		} catch (error) {
			expect(error).toMatchObject({
				status: 303,
				location: '/login?next=%2Fdashboard%3Ftab%3Dquizzes'
			});
		}
	});

	it('enforces authenticated teacher on API routes', () => {
		expect(requireAuthenticatedTeacher(teacher)).toBe(teacher);
		expect(() => requireAuthenticatedTeacher(null)).toThrowError(
			expect.objectContaining({ status: 401, code: 'unauthenticated' })
		);
	});
});
