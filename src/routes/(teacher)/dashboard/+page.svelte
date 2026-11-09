<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import EnergyIcon from '#lib/components/EnergyIcon.svelte';
	import QrCodeModal from '#lib/components/QrCodeModal.svelte';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { gsapStagger } from '#lib/shared/animations.js';
	import { readApiError } from '#lib/shared/api-error.js';
	import { BRAND } from '#lib/shared/brand.js';
	import { QUIZ_LIMITS, type QuizStatus, type QuizSummary } from '#lib/shared/quiz.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let newTitle = $state('');
	let newDescription = $state('');
	let creating = $state(false);
	let createError = $state('');
	let createFieldErrors = $state<Record<string, string>>({});

	let signingOut = $state(false);
	let busyQuizId = $state<string | null>(null);
	let confirmingArchiveId = $state<string | null>(null);
	let confirmingDeleteId = $state<string | null>(null);
	let actionError = $state('');
	let actionNotice = $state('');
	let qrModalSession = $state<{
		quizTitle: string;
		joinCode: string;
		joinUrl: string;
	} | null>(null);

	function statusLabel(status: QuizStatus): string {
		if (status === 'published') return 'Published';
		if (status === 'archived') return 'Archived';
		return 'Draft';
	}

	function formatQuestionCount(count: number): string {
		return count === 1 ? '1 question' : `${count} questions`;
	}

	async function handleCreateQuiz(event: SubmitEvent) {
		event.preventDefault();
		if (creating) return;

		creating = true;
		createError = '';
		createFieldErrors = {};
		actionError = '';
		actionNotice = '';

		try {
			const response = await fetch('/api/quizzes', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title: newTitle,
					description: newDescription || null,
					questions: []
				})
			});

			if (!response.ok) {
				const apiError = await readApiError(response);
				createError = apiError.message;
				createFieldErrors = apiError.fields;
				return;
			}

			const body = (await response.json()) as { quiz: { id: string } };
			newTitle = '';
			newDescription = '';
			await goto(resolve('/(teacher)/quizzes/[quizId]', { quizId: body.quiz.id }));
		} catch {
			createError = 'Could not reach the server. Try again.';
		} finally {
			creating = false;
		}
	}

	async function handlePublish(quiz: QuizSummary) {
		if (busyQuizId) return;
		busyQuizId = quiz.id;
		actionError = '';
		actionNotice = '';

		try {
			const response = await fetch(`/api/quizzes/${encodeURIComponent(quiz.id)}/publish`, {
				method: 'POST'
			});
			if (!response.ok) {
				const apiError = await readApiError(response);
				actionError = apiError.message;
				return;
			}
			actionNotice = `Published "${quiz.title}".`;
			await invalidateAll();
		} catch {
			actionError = 'Could not reach the server. Try again.';
		} finally {
			busyQuizId = null;
		}
	}

	async function handleStartSession(quiz: QuizSummary, openQr: boolean = false) {
		if (busyQuizId) return;
		busyQuizId = quiz.id;
		actionError = '';
		actionNotice = '';

		try {
			const response = await fetch(`/api/quizzes/${encodeURIComponent(quiz.id)}/sessions`, {
				method: 'POST'
			});
			if (!response.ok) {
				const apiError = await readApiError(response);
				actionError = apiError.message;
				return;
			}
			const body = (await response.json()) as { session: { id: string } };
			const basePath = resolve('/(teacher)/sessions/[sessionId]', { sessionId: body.session.id });
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			await goto(openQr ? `${basePath}?qr=1` : basePath);
		} catch {
			actionError = 'Could not reach the server. Try again.';
		} finally {
			busyQuizId = null;
		}
	}

	async function handleArchive(quiz: QuizSummary) {
		if (busyQuizId) return;
		busyQuizId = quiz.id;
		actionError = '';
		actionNotice = '';

		try {
			const response = await fetch(`/api/quizzes/${encodeURIComponent(quiz.id)}/archive`, {
				method: 'POST'
			});
			if (!response.ok) {
				const apiError = await readApiError(response);
				actionError = apiError.message;
				return;
			}
			confirmingArchiveId = null;
			actionNotice = `Archived "${quiz.title}".`;
			await invalidateAll();
		} catch {
			actionError = 'Could not reach the server. Try again.';
		} finally {
			busyQuizId = null;
		}
	}

	async function handleDelete(quiz: QuizSummary) {
		if (busyQuizId) return;
		busyQuizId = quiz.id;
		actionError = '';
		actionNotice = '';

		try {
			const response = await fetch(`/api/quizzes/${encodeURIComponent(quiz.id)}`, {
				method: 'DELETE'
			});
			if (!response.ok) {
				const apiError = await readApiError(response);
				actionError = apiError.message;
				return;
			}
			confirmingDeleteId = null;
			actionNotice = `Deleted "${quiz.title}".`;
			await invalidateAll();
		} catch {
			actionError = 'Could not reach the server. Try again.';
		} finally {
			busyQuizId = null;
		}
	}

	async function handleLogout() {
		if (signingOut) return;

		signingOut = true;
		actionError = '';

		try {
			const response = await fetch('/api/auth/logout', { method: 'POST' });
			if (!response.ok) {
				const apiError = await readApiError(response);
				actionError = apiError.message;
				return;
			}
			await goto(resolve('/login'), { invalidateAll: true });
		} catch {
			actionError = 'Could not reach the server. Try again.';
		} finally {
			signingOut = false;
		}
	}
</script>

<svelte:head>
	<title>Dashboard · {BRAND.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<SiteHeader teacher={data.teacher} />

	<main class="teacher-main">
		<section class="panel teacher-hero" aria-labelledby="dashboard-title">
			<div class="teacher-hero-top">
				<div>
					<p class="auth-eyebrow">Teacher dashboard</p>
					<h1 id="dashboard-title">Welcome, {data.teacher.displayName}</h1>
					<p class="auth-intro">
						Signed in as {data.teacher.email}. Create quizzes, author questions, and publish when
						ready to host.
					</p>
				</div>
				<button
					class="button button-secondary"
					type="button"
					onclick={handleLogout}
					disabled={signingOut}
				>
					{signingOut ? 'Signing out…' : 'Sign out'}
				</button>
			</div>

			<form class="create-quiz-form" onsubmit={handleCreateQuiz} novalidate>
				<h2>Create a new quiz</h2>

				{#if createError}
					<p class="form-error" role="alert">{createError}</p>
				{/if}

				<div class="create-quiz-grid">
					<div class="field">
						<label for="new-quiz-title">Quiz title</label>
						<input
							id="new-quiz-title"
							name="title"
							type="text"
							maxlength={QUIZ_LIMITS.maxTitleLength}
							placeholder="e.g. World Geography Warm-Up"
							bind:value={newTitle}
							aria-invalid={createFieldErrors.title ? 'true' : undefined}
							required
						/>
						{#if createFieldErrors.title}
							<p class="field-error">{createFieldErrors.title}</p>
						{/if}
					</div>

					<div class="field">
						<label for="new-quiz-description">Description (optional)</label>
						<input
							id="new-quiz-description"
							name="description"
							type="text"
							maxlength={QUIZ_LIMITS.maxDescriptionLength}
							placeholder="Short summary for your own reference"
							bind:value={newDescription}
							aria-invalid={createFieldErrors.description ? 'true' : undefined}
						/>
						{#if createFieldErrors.description}
							<p class="field-error">{createFieldErrors.description}</p>
						{/if}
					</div>
				</div>

				<div class="create-actions-row">
					<button class="button button-primary" type="submit" disabled={creating}>
						{#if creating}
							<span class="gruv-spinner" aria-hidden="true"></span>
						{:else}
							<EnergyIcon name="plus" />
						{/if}
						{creating ? 'Creating…' : 'Create draft & add questions'}
					</button>
					<a class="button button-secondary" href={resolve('/(teacher)/library')}>
						<EnergyIcon name="search" /> Browse Shared Library
					</a>
				</div>
			</form>
		</section>

		<section class="quiz-list-section" aria-labelledby="quizzes-heading">
			<div class="section-header">
				<h2 id="quizzes-heading">Your quizzes ({data.quizzes.length})</h2>
			</div>

			{#if actionError}
				<p class="form-error" role="alert">{actionError}</p>
			{/if}

			{#if actionNotice}
				<p class="status-notice" role="status">{actionNotice}</p>
			{/if}

			{#if data.quizzes.length === 0}
				<div class="panel empty-state">
					<h3>No quizzes yet</h3>
					<p>Create your first quiz above to start adding multiple-choice questions.</p>
				</div>
			{:else}
				<ul class="quiz-list" use:gsapStagger={{ selector: '.quiz-card' }}>
					{#each data.quizzes as quiz (quiz.id)}
						<li class="panel quiz-card">
							<div class="quiz-card-header">
								<div>
									<div class="quiz-badges">
										<span class="status-badge status-{quiz.status}">
											Status: {statusLabel(quiz.status)}
										</span>
										{#if quiz.isPublic}
											<span class="status-badge status-shared"
												><EnergyIcon name="check" /> Shared</span
											>
										{/if}
										<span class="meta-pill">{formatQuestionCount(quiz.questionCount)}</span>
									</div>
									<h3>{quiz.title}</h3>
									{#if quiz.description}
										<p class="quiz-description">{quiz.description}</p>
									{/if}
								</div>
							</div>

							<div class="quiz-card-actions">
								{#if quiz.status === 'published'}
									<button
										class="button button-primary"
										type="button"
										onclick={() => handleStartSession(quiz, false)}
										disabled={busyQuizId === quiz.id}
									>
										<EnergyIcon name="bolt" />
										{busyQuizId === quiz.id ? 'Opening lobby…' : 'Host live session'}
									</button>
									<button
										class="button button-secondary"
										type="button"
										onclick={() => handleStartSession(quiz, true)}
										disabled={busyQuizId === quiz.id}
									>
										<EnergyIcon name="qr-code" />
										Share QR code
									</button>
								{/if}

								<a
									class="button {quiz.status === 'published'
										? 'button-secondary'
										: 'button-primary'}"
									href={resolve('/(teacher)/quizzes/[quizId]', { quizId: quiz.id })}
								>
									<EnergyIcon name="pencil" />
									{quiz.status === 'archived' ? 'View quiz' : 'Edit quiz'}
								</a>

								{#if quiz.status === 'draft'}
									<button
										class="button button-secondary"
										type="button"
										onclick={() => handlePublish(quiz)}
										disabled={busyQuizId === quiz.id}
									>
										{busyQuizId === quiz.id ? 'Publishing…' : 'Publish'}
									</button>
								{/if}

								{#if quiz.status !== 'archived'}
									{#if confirmingArchiveId === quiz.id}
										<div class="confirm-inline" role="group" aria-label="Confirm archive">
											<span>Archive this quiz?</span>
											<button
												class="button button-secondary"
												type="button"
												onclick={() => handleArchive(quiz)}
												disabled={busyQuizId === quiz.id}
											>
												Confirm archive
											</button>
											<button
												class="button button-secondary"
												type="button"
												onclick={() => (confirmingArchiveId = null)}
												disabled={busyQuizId === quiz.id}
											>
												Cancel
											</button>
										</div>
									{:else}
										<button
											class="button button-secondary"
											type="button"
											onclick={() => {
												confirmingDeleteId = null;
												confirmingArchiveId = quiz.id;
											}}
											disabled={busyQuizId === quiz.id}
										>
											Archive
										</button>
									{/if}
								{/if}

								{#if confirmingDeleteId === quiz.id}
									<div class="confirm-inline" role="group" aria-label="Confirm delete">
										<span>Permanently delete "{quiz.title}"?</span>
										<button
											class="button button-danger"
											type="button"
											onclick={() => handleDelete(quiz)}
											disabled={busyQuizId === quiz.id}
										>
											Confirm delete
										</button>
										<button
											class="button button-secondary"
											type="button"
											onclick={() => (confirmingDeleteId = null)}
											disabled={busyQuizId === quiz.id}
										>
											Cancel
										</button>
									</div>
								{:else}
									<button
										class="button button-secondary"
										type="button"
										onclick={() => {
											confirmingArchiveId = null;
											confirmingDeleteId = quiz.id;
										}}
										disabled={busyQuizId === quiz.id}
									>
										Delete
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if data.recentSessions && data.recentSessions.length > 0}
			<section class="quiz-list-section" aria-labelledby="recent-sessions-heading">
				<div class="section-header">
					<h2 id="recent-sessions-heading">Recent live sessions ({data.recentSessions.length})</h2>
				</div>

				<ul class="quiz-list">
					{#each data.recentSessions as sessionItem (sessionItem.id)}
						<li class="panel quiz-card">
							<div class="quiz-card-header">
								<div>
									<div class="quiz-badges">
										<span class="meta-pill">Code: {sessionItem.joinCode}</span>
										<span class="meta-pill">Status: {sessionItem.status}</span>
										<span class="meta-pill">{sessionItem.participantCount} players</span>
									</div>
									<h3>{sessionItem.quizTitle}</h3>
								</div>
							</div>

							<div class="quiz-card-actions">
								<a
									class="button button-primary"
									href={resolve('/(teacher)/sessions/[sessionId]/results', {
										sessionId: sessionItem.id
									})}
								>
									View results & leaderboard
								</a>
								<a
									class="button button-secondary"
									href={resolve('/(teacher)/sessions/[sessionId]', {
										sessionId: sessionItem.id
									})}
								>
									Open session room
								</a>
								{#if sessionItem.status === 'lobby' || sessionItem.status === 'in_progress'}
									<button
										class="button button-secondary"
										type="button"
										onclick={() => {
											qrModalSession = {
												quizTitle: sessionItem.quizTitle,
												joinCode: sessionItem.joinCode,
												joinUrl: `${window.location.origin}/join/${sessionItem.joinCode}`
											};
										}}
									>
										Share QR code
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</main>

	{#if qrModalSession}
		<QrCodeModal
			open={true}
			quizTitle={qrModalSession.quizTitle}
			joinCode={qrModalSession.joinCode}
			joinUrl={qrModalSession.joinUrl}
			onClose={() => (qrModalSession = null)}
		/>
	{/if}

	<footer class="site-footer">
		<p>{BRAND.name} · {BRAND.tagline}</p>
	</footer>
</div>

<style>
	.teacher-main {
		display: grid;
		align-content: start;
		gap: var(--space-6);
		padding-block: var(--space-6);
	}

	.teacher-hero {
		width: 100%;
	}

	.teacher-hero-top {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.create-quiz-form {
		display: grid;
		gap: var(--space-4);
		margin-top: var(--space-6);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-4);
	}

	.create-quiz-form h2 {
		font-size: 1.25rem;
	}

	.create-quiz-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: var(--space-4);
	}

	.quiz-list-section {
		display: grid;
		gap: var(--space-4);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.quiz-list {
		display: grid;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.quiz-card {
		width: 100%;
		padding: var(--space-5);
	}

	.quiz-card-header h3 {
		margin-top: var(--space-2);
		font-size: 1.35rem;
	}

	.quiz-description {
		margin-top: var(--space-2);
		color: var(--color-muted);
	}

	.quiz-badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.status-badge,
	.meta-pill {
		display: inline-flex;
		align-items: center;
		border-radius: var(--radius-pill);
		padding: 0.2rem 0.7rem;
		font-size: 0.78rem;
		font-weight: 800;
	}

	.status-draft {
		border: 1px solid var(--gruv-yellow);
		background: #3b311a;
		color: var(--gruv-yellow);
	}

	.status-published {
		border: 1px solid var(--gruv-green);
		background: #2b331b;
		color: var(--gruv-green);
	}

	.status-shared {
		border: 1px solid var(--gruv-blue);
		background: #1c2e3d;
		color: var(--gruv-blue);
		gap: 0.35rem;
	}

	.create-actions-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.status-archived {
		border: 1px solid var(--color-border);
		background: var(--color-tint);
		color: var(--color-muted);
	}

	.meta-pill {
		border: 1px solid var(--color-border);
		background: var(--gruv-bg1);
		color: var(--color-muted);
	}

	.quiz-card-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}

	.confirm-inline {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-2) var(--space-3);
		font-size: 0.88rem;
		font-weight: 400;
	}

	.button-danger {
		border-color: var(--color-danger);
		background: var(--color-danger);
		color: var(--gruv-bg-hard);
	}

	.status-notice {
		border: 2px solid var(--gruv-green);
		border-radius: var(--radius-sm);
		background: #2b331b;
		padding: var(--space-3);
		color: var(--gruv-fg0);
		font-size: 0.9rem;
		font-weight: 400;
	}

	.empty-state {
		width: 100%;
		text-align: center;
	}

	.empty-state p {
		margin-top: var(--space-2);
		color: var(--color-muted);
	}
</style>
