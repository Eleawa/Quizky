import type { PageServerLoad } from './$types';
import { getDb } from '#lib/server/db/client.js';
import { listLibraryQuizzes } from '#lib/server/quizzes/service.js';

export const load: PageServerLoad = async ({ platform, url }) => {
	const search = url.searchParams.get('q') ?? url.searchParams.get('search') ?? undefined;
	const quizzes = await listLibraryQuizzes(getDb(platform), search);

	return {
		quizzes,
		searchQuery: search ?? ''
	};
};
