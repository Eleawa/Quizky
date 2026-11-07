import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/server/api/errors.js';
import {
	enforceIdentityRateLimit,
	enforceRateLimit,
	extractClientIdentifier,
	FixedWindowRateLimiter,
	resetGlobalRateLimits
} from '../../src/lib/server/security/rate-limit.js';

describe('FixedWindowRateLimiter and HTTP abuse protection', () => {
	it('allows requests up to maxRequests within the window and rejects excess with retryAfterSeconds', () => {
		const limiter = new FixedWindowRateLimiter();
		const policy = { maxRequests: 3, windowMs: 10_000 };
		const t0 = 1_700_000_000_000;

		expect(limiter.check('login:198.51.100.1', policy, t0)).toEqual({
			allowed: true,
			remaining: 2,
			retryAfterSeconds: 0
		});
		expect(limiter.check('login:198.51.100.1', policy, t0 + 1000)).toEqual({
			allowed: true,
			remaining: 1,
			retryAfterSeconds: 0
		});
		expect(limiter.check('login:198.51.100.1', policy, t0 + 2000)).toEqual({
			allowed: true,
			remaining: 0,
			retryAfterSeconds: 0
		});

		const blocked = limiter.check('login:198.51.100.1', policy, t0 + 3500);
		expect(blocked.allowed).toBe(false);
		expect(blocked.remaining).toBe(0);
		expect(blocked.retryAfterSeconds).toBe(7);

		// Different client key is unaffected
		expect(limiter.check('login:198.51.100.2', policy, t0 + 3500).allowed).toBe(true);

		// Window resets after windowMs elapses
		const afterReset = limiter.check('login:198.51.100.1', policy, t0 + 10_000);
		expect(afterReset.allowed).toBe(true);
		expect(afterReset.remaining).toBe(2);
	});

	it('extracts client identifier from cf-connecting-ip, x-forwarded-for, or getClientAddress', () => {
		const cfReq = new Request('https://quizky.example.com/api/auth/login', {
			headers: {
				'cf-connecting-ip': '203.0.113.42',
				'x-forwarded-for': '192.0.2.1'
			}
		});
		expect(
			extractClientIdentifier({
				request: cfReq,
				getClientAddress: () => '127.0.0.1'
			})
		).toBe('203.0.113.42');

		const xffReq = new Request('https://quizky.example.com/api/auth/login', {
			headers: {
				'x-forwarded-for': '192.0.2.10, 10.0.0.1'
			}
		});
		expect(
			extractClientIdentifier({
				request: xffReq,
				getClientAddress: () => '127.0.0.1'
			})
		).toBe('192.0.2.10');

		const plainReq = new Request('https://quizky.example.com/api/auth/login');
		expect(
			extractClientIdentifier({
				request: plainReq,
				getClientAddress: () => {
					throw new Error('No socket');
				}
			})
		).toBe('local');
	});

	it('throws 429 rate_limited ApiError from enforceRateLimit when threshold is exceeded', () => {
		resetGlobalRateLimits();
		const event = {
			request: new Request('https://quizky.example.com/api/sessions/ABCDEF/join', {
				headers: { 'cf-connecting-ip': '203.0.113.99' }
			}),
			getClientAddress: () => '203.0.113.99'
		};

		const policy = { maxRequests: 2, windowMs: 60_000 };
		const now = 1_700_000_000_000;

		enforceRateLimit(event, 'session_join', policy, now);
		enforceRateLimit(event, 'session_join', policy, now + 100);

		expect(() => enforceRateLimit(event, 'session_join', policy, now + 200)).toThrowError(
			expect.objectContaining({
				status: 429,
				code: 'rate_limited'
			}) satisfies Partial<ApiError>
		);
		resetGlobalRateLimits();
	});

	it('normalizes email identity and enforces per-identity rate limits across IPs', () => {
		resetGlobalRateLimits();
		const policy = { maxRequests: 2, windowMs: 60_000 };
		const now = 1_700_000_000_000;

		enforceIdentityRateLimit('auth_identity', 'Teacher@Example.com', policy, now);
		enforceIdentityRateLimit('auth_identity', '  teacher@example.com ', policy, now + 100);

		expect(() =>
			enforceIdentityRateLimit('auth_identity', 'TEACHER@EXAMPLE.COM', policy, now + 200)
		).toThrowError(
			expect.objectContaining({
				status: 429,
				code: 'rate_limited'
			}) satisfies Partial<ApiError>
		);
		resetGlobalRateLimits();
	});
});
