// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { PublicTeacher } from './lib/server/auth/types.js';

declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		interface Locals {
			teacher: PublicTeacher | null;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
