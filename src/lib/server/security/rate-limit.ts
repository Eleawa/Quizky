import type { RequestEvent } from '@sveltejs/kit';
import { ApiError } from '../api/errors.js';

export interface RateLimitOptions {
	maxRequests: number;
	windowMs: number;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	retryAfterSeconds: number;
}

interface BucketEntry {
	windowStartMs: number;
	count: number;
}

const MAX_TRACKED_KEYS = 5_000;

export class FixedWindowRateLimiter {
	private readonly buckets = new Map<string, BucketEntry>();

	check(key: string, options: RateLimitOptions, nowMs: number = Date.now()): RateLimitResult {
		if (this.buckets.size >= MAX_TRACKED_KEYS) {
			this.pruneExpired(options.windowMs, nowMs);
		}

		const existing = this.buckets.get(key);
		if (!existing || nowMs - existing.windowStartMs >= options.windowMs) {
			this.buckets.set(key, {
				windowStartMs: nowMs,
				count: 1
			});
			return {
				allowed: true,
				remaining: Math.max(0, options.maxRequests - 1),
				retryAfterSeconds: 0
			};
		}

		if (existing.count >= options.maxRequests) {
			const remainingMs = Math.max(1, options.windowMs - (nowMs - existing.windowStartMs));
			return {
				allowed: false,
				remaining: 0,
				retryAfterSeconds: Math.ceil(remainingMs / 1000)
			};
		}

		existing.count += 1;
		return {
			allowed: true,
			remaining: Math.max(0, options.maxRequests - existing.count),
			retryAfterSeconds: 0
		};
	}

	reset(): void {
		this.buckets.clear();
	}

	private pruneExpired(windowMs: number, nowMs: number): void {
		for (const [key, entry] of this.buckets.entries()) {
			if (nowMs - entry.windowStartMs >= windowMs) {
				this.buckets.delete(key);
			}
		}
		if (this.buckets.size >= MAX_TRACKED_KEYS) {
			const oldestKey = this.buckets.keys().next().value;
			if (oldestKey !== undefined) {
				this.buckets.delete(oldestKey);
			}
		}
	}
}

const globalRateLimiter = new FixedWindowRateLimiter();

export const RATE_LIMIT_POLICIES = {
	authRegister: { maxRequests: 15, windowMs: 60_000 },
	authLogin: { maxRequests: 15, windowMs: 60_000 },
	authIdentity: { maxRequests: 10, windowMs: 60_000 },
	sessionLookup: { maxRequests: 300, windowMs: 60_000 },
	sessionJoin: { maxRequests: 300, windowMs: 60_000 }
} as const satisfies Record<string, RateLimitOptions>;

export function extractClientIdentifier(
	event: Pick<RequestEvent, 'request' | 'getClientAddress'>
): string {
	const cfIp = event.request.headers.get('cf-connecting-ip')?.trim();
	if (cfIp) {
		return cfIp;
	}

	const forwardedFor = event.request.headers.get('x-forwarded-for');
	if (forwardedFor) {
		const first = forwardedFor.split(',')[0]?.trim();
		if (first) {
			return first;
		}
	}

	try {
		const addr = event.getClientAddress();
		if (addr) {
			return addr;
		}
	} catch {
		// Fallback when getClientAddress is unavailable in test or custom adapter contexts.
	}

	return 'local';
}

export function enforceRateLimit(
	event: Pick<RequestEvent, 'request' | 'getClientAddress'>,
	bucketName: string,
	options: RateLimitOptions,
	nowMs: number = Date.now()
): RateLimitResult {
	const clientId = extractClientIdentifier(event);
	const key = `${bucketName}:${clientId}`;
	const result = globalRateLimiter.check(key, options, nowMs);

	if (!result.allowed) {
		throw new ApiError(
			429,
			'rate_limited',
			`Too many requests. Please wait ${result.retryAfterSeconds}s and try again.`
		);
	}

	return result;
}

export function enforceIdentityRateLimit(
	bucketName: string,
	identity: string,
	options: RateLimitOptions,
	nowMs: number = Date.now()
): RateLimitResult {
	const normalized = identity.trim().toLowerCase().slice(0, 254);
	const key = `${bucketName}:${normalized}`;
	const result = globalRateLimiter.check(key, options, nowMs);

	if (!result.allowed) {
		throw new ApiError(
			429,
			'rate_limited',
			`Too many requests. Please wait ${result.retryAfterSeconds}s and try again.`
		);
	}

	return result;
}

export function resetGlobalRateLimits(): void {
	globalRateLimiter.reset();
}
