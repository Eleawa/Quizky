<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import EnergyIcon from '#lib/components/EnergyIcon.svelte';
	import QuizPreviewModal from '#lib/components/QuizPreviewModal.svelte';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { gsapStagger } from '#lib/shared/animations.js';
	import { readApiError } from '#lib/shared/api-error.js';
	import { BRAND } from '#lib/shared/brand.js';
	import type { LibraryQuizDetail, LibraryQuizSummary } from '#lib/shared/quiz.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let previewQuiz = $state<LibraryQuizDetail | null>(null);
	let previewModalOpen = $state(false);
	let previewLoading = $state(false);
	let cloningId = $state<string | null>(null);
	let actionError = $state('');
	let actionNotice = $state('');

	function formatQuestionCount(count: number): string {
		return count === 1 ? '1 question' : `${count} questions`;
	}

	function formatDate(timestamp: Date | string): string {
		const date = new Date(timestamp);
		return date.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	async function openPreview(quizSummary: LibraryQuizSummary) {
		previewModalOpen = true;
		previewLoading = true;
		previewQuiz = null;
		actionError = '';

		try {
			const response = await fetch(`/api/library/${encodeURIComponent(quizSummary.id)}`);
			if (!response.ok) {
				const apiError = await readApiError(response);
				actionError = apiError.message;
				previewModalOpen = false;
				return;
			}
			const body = (await response.json()) as { quiz: LibraryQuizDetail };
			previewQuiz = body.quiz;
		} catch {
			actionError = 'Could not load quiz details. Try again.';
			previewModalOpen = false;
		} finally {
			previewLoading = false;
		}
	}

	async function handleClone(quizId: string) {
		if (cloningId) return;

		cloningId = quizId;
		actionError = '';
		actionNotice = '';

		try {
			const response = await fetch(`/api/library/${encodeURIComponent(quizId)}/clone`, {
				method: 'POST'
			});

			if (!response.ok) {
				const apiError = await readApiError(response);
				actionError = apiError.message;
				return;
			}

			const body = (await response.json()) as { quiz: { id: string } };
			actionNotice = 'Quiz cloned into your account! Redirecting…';
			previewModalOpen = false;
			await goto(resolve('/(teacher)/quizzes/[quizId]', { quizId: body.quiz.id }));
		} catch {
			actionError = 'Could not clone quiz. Try again.';
		} finally {
			cloningId = null;
		}
	}
</script>

<svelte:head>
	<title>Quiz Library · {BRAND.name}</title>
	<meta name="description" content="Explore quizzes shared by teachers in the Quizky community." />
</svelte:head>

<div class="page">
	<SiteHeader teacher={data.teacher} />

	<main class="library-main">
		<div class="library-topbar">
			<a class="nav-link" href={resolve('/(teacher)/dashboard')}>
				<EnergyIcon name="arrow-left" /> Back to dashboard
			</a>
		</div>

		<section class="panel library-hero">
			<span class="auth-eyebrow">Community</span>
			<h1>Quiz Library</h1>
			<p class="library-intro">
				Explore quizzes created and shared by teachers. Preview questions or clone any quiz to your
				account to customize and host.
			</p>

			<form class="library-search-form" method="GET" action={resolve('/(teacher)/library')}>
				<div class="search-input-wrapper">
					<span class="search-icon" aria-hidden="true">
						<EnergyIcon name="search" />
					</span>
					<input
						type="search"
						name="q"
						value={data.searchQuery}
						placeholder="Search by quiz title, description, or teacher…"
						aria-label="Search shared quizzes"
					/>
					{#if data.searchQuery}
						<a
							class="clear-btn"
							href={resolve('/(teacher)/library')}
							aria-label="Clear search query"
						>
							<EnergyIcon name="close" size="0.85em" />
						</a>
					{/if}
				</div>
				<button class="button button-primary" type="submit">Search</button>
			</form>
		</section>

		{#if actionNotice}
			<p class="status-notice" role="status">{actionNotice}</p>
		{/if}

		{#if actionError}
			<p class="form-error" role="alert">{actionError}</p>
		{/if}

		<section class="library-content" aria-labelledby="library-results-heading">
			<div class="results-header">
				<h2 id="library-results-heading">
					Shared quizzes
					<span class="results-count">({data.quizzes.length})</span>
				</h2>
			</div>

			{#if data.quizzes.length === 0}
				<div class="panel empty-state">
					<div class="empty-icon" aria-hidden="true">
						<EnergyIcon name="search" size="2em" />
					</div>
					<h3>No shared quizzes found</h3>
					{#if data.searchQuery}
						<p>No quizzes matched your search query "{data.searchQuery}".</p>
						<a class="button button-secondary" href={resolve('/(teacher)/library')}>
							Clear search filter
						</a>
					{:else}
						<p>
							No quizzes have been shared yet. Publish a quiz from your dashboard and check "Share
							with other teachers in Community Library" to list it here!
						</p>
					{/if}
				</div>
			{:else}
				<ul class="library-grid" use:gsapStagger={{ selector: '.library-card' }}>
					{#each data.quizzes as quiz (quiz.id)}
						<li class="panel library-card">
							<div class="library-card-header">
								<div class="card-meta-top">
									<span class="author-badge">
										<EnergyIcon name="user" size="0.9em" />
										{quiz.authorName}
									</span>
									{#if quiz.teacherId === data.teacher.id}
										<span class="your-quiz-pill">Your quiz</span>
									{/if}
									<span class="question-pill">{formatQuestionCount(quiz.questionCount)}</span>
								</div>
								<h3>{quiz.title}</h3>
								{#if quiz.description}
									<p class="quiz-desc">{quiz.description}</p>
								{/if}
							</div>

							<div class="card-date">
								Updated {formatDate(quiz.updatedAt)}
							</div>

							<div class="library-card-actions">
								<button
									class="button button-secondary"
									type="button"
									onclick={() => openPreview(quiz)}
								>
									<EnergyIcon name="eye" /> Preview
								</button>
								<button
									class="button button-primary"
									type="button"
									disabled={cloningId === quiz.id}
									onclick={() => handleClone(quiz.id)}
								>
									{#if cloningId === quiz.id}
										<span class="gruv-spinner" aria-hidden="true"></span>
										Cloning…
									{:else}
										<EnergyIcon name="plus" /> Clone quiz
									{/if}
								</button>
								{#if quiz.teacherId === data.teacher.id}
									<a
										class="button button-secondary button-small"
										href={resolve('/(teacher)/quizzes/[quizId]', { quizId: quiz.id })}
									>
										Edit original
									</a>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</main>

	<footer class="site-footer">
		<p>{BRAND.name} · {BRAND.tagline}</p>
	</footer>
</div>

<QuizPreviewModal
	open={previewModalOpen}
	quiz={previewQuiz}
	loading={previewLoading}
	cloning={cloningId !== null}
	onClose={() => (previewModalOpen = false)}
	onClone={handleClone}
/>

<style>
	.library-main {
		display: grid;
		align-content: start;
		gap: var(--space-6);
		padding-block: var(--space-6);
	}

	.library-topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.library-hero {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-6);
	}

	.library-intro {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.95rem;
		max-width: 48rem;
		line-height: 1.5;
	}

	.library-search-form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}

	.search-input-wrapper {
		position: relative;
		flex: 1;
		min-width: 16rem;
		display: flex;
		align-items: center;
	}

	.search-icon {
		position: absolute;
		left: 0.85rem;
		color: var(--color-muted);
		pointer-events: none;
	}

	.search-input-wrapper input {
		width: 100%;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--gruv-bg-hard);
		padding: 0.65rem 2.4rem 0.65rem 2.4rem;
		color: var(--color-heading);
		font: inherit;
		transition:
			border-color 140ms ease,
			box-shadow 140ms ease;
	}

	.search-input-wrapper input:focus {
		border-color: var(--gruv-orange);
		outline: none;
		box-shadow: 0 0 0 3px rgba(254, 128, 25, 0.2);
	}

	.clear-btn {
		position: absolute;
		right: 0.5rem;
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
	}

	.clear-btn:hover {
		color: var(--color-heading);
		background: var(--gruv-bg2);
	}

	.results-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: var(--space-4);
	}

	.results-header h2 {
		margin: 0;
		font-size: 1.25rem;
		color: var(--color-heading);
	}

	.results-count {
		font-size: 0.95rem;
		color: var(--color-muted);
		font-weight: 400;
	}

	.library-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
		gap: var(--space-4);
	}

	.library-card {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-5);
		border: 2px solid var(--color-border);
		transition:
			border-color 140ms ease,
			transform 140ms ease;
	}

	.library-card:hover {
		border-color: var(--gruv-orange);
		transform: translateY(-2px);
	}

	.card-meta-top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.author-badge,
	.question-pill,
	.your-quiz-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border-radius: var(--radius-pill);
		padding: 0.2rem 0.6rem;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.author-badge {
		border: 1px solid var(--color-border);
		background: var(--gruv-bg1);
		color: var(--color-heading);
	}

	.your-quiz-pill {
		border: 1px solid var(--gruv-green);
		background: rgba(184, 187, 38, 0.15);
		color: var(--gruv-green);
	}

	.question-pill {
		border: 1px solid var(--color-border);
		background: var(--gruv-bg-hard);
		color: var(--color-muted);
	}

	.library-card h3 {
		margin: 0;
		font-size: 1.15rem;
		color: var(--color-heading);
		line-height: 1.35;
	}

	.quiz-desc {
		margin: var(--space-2) 0 0;
		font-size: 0.85rem;
		color: var(--color-muted);
		line-height: 1.45;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-date {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.library-card-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border);
	}

	.empty-state {
		text-align: center;
		padding: var(--space-8);
		display: grid;
		place-items: center;
		gap: var(--space-3);
	}

	.empty-icon {
		color: var(--color-muted);
	}

	.empty-state h3 {
		margin: 0;
		color: var(--color-heading);
	}

	.empty-state p {
		margin: 0;
		color: var(--color-muted);
		max-width: 28rem;
		font-size: 0.9rem;
		line-height: 1.5;
	}
</style>
