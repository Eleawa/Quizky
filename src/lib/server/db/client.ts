import { env as workerEnv } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ApiError } from '../api/errors.js';
import * as schema from './schema.js';

export function createDb(d1: D1Database) {
	return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;

export function resolvePlatformEnv(platform: App.Platform | undefined): Env | undefined {
	if (platform?.env) return platform.env;

	const devProxy = (globalThis as { __sveltekit_cloudflare_platform?: { env?: Env } })
		.__sveltekit_cloudflare_platform;
	if (devProxy?.env) return devProxy.env;

	try {
		if (workerEnv && 'DB' in workerEnv) {
			return workerEnv;
		}
	} catch {
		// Outside a Worker request or before dev proxy initialization.
	}

	return undefined;
}

export function getDb(platform: App.Platform | undefined): Database {
	const d1 = resolvePlatformEnv(platform)?.DB;
	if (!d1) {
		throw new ApiError(503, 'database_unavailable', 'The database is temporarily unavailable.');
	}
	return createDb(d1);
}
