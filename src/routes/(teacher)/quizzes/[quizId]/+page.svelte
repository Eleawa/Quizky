<script lang="ts">
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { readApiError } from '#lib/shared/api-error.js';
	import { BRAND } from '#lib/shared/brand.js';
	import {
		QUIZ_LIMITS,
		type QuizDetail,
		type QuizQuestionInput,
		type QuizStatus
	} from '#lib/shared/quiz.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	interface EditableOption {
		key: string;
		text: string;
		isCorrect: boolean;
	}

	interface EditableQuestion {
		key: string;
		text: string;
		imageUrl: string | null;
		timeLimitSeconds: number;
		points: number;
		options: EditableOption[];
	}

	function toEditableQuestions(quiz: QuizDetail): EditableQuestion[] {
		return quiz.questions.map((question) => ({
			key: question.id,
			text: question.text,
			imageUrl: question.imageUrl ?? null,
			timeLimitSeconds: question.timeLimitSeconds,
			points: question.points,
			options: question.options.map((option) => ({
				key: option.id,
				text: option.text,
				isCorrect: option.isCorrect
			}))
		}));
	}

	function snapshotPayload(
		currentTitle: string,
		currentDescription: string,
		currentQuestions: EditableQuestion[]
	): string {
		return JSON.stringify({
			title: currentTitle.trim(),
			description: currentDescription.trim() || null,
			questions: currentQuestions.map((question) => ({
				text: question.text.trim(),
				imageUrl: question.imageUrl ?? null,
				timeLimitSeconds: Number(question.timeLimitSeconds),
				points: Number(question.points),
				options: question.options.map((option) => ({
					text: option.text.trim(),
					isCorrect: option.isCorrect
				}))
			}))
		});
	}

	function initialQuiz(): QuizDetail {
		return data.quiz;
	}

	const initial = initialQuiz();

	let title = $state(initial.title);
	let description = $state(initial.description ?? '');
	let status = $state<QuizStatus>(initial.status);
	let questions = $state<EditableQuestion[]>(toEditableQuestions(initial));
	let savedSnapshot = $state(
		snapshotPayload(initial.title, initial.description ?? '', toEditableQuestions(initial))
	);

	let saving = $state(false);
	let publishing = $state(false);
	let hosting = $state(false);
	let archiving = $state(false);
	let deleting = $state(false);
	let confirmingArchive = $state(false);
	let confirmingDelete = $state(false);
	let formError = $state('');
	let statusNotice = $state('');
	let fieldErrors = $state<Record<string, string>>({});

	let isArchived = $derived(status === 'archived');
	let isDirty = $derived(
		!isArchived && snapshotPayload(title, description, questions) !== savedSnapshot
	);

	beforeNavigate(({ cancel }) => {
		if (isDirty && !window.confirm('You have unsaved changes. Leave without saving?')) {
			cancel();
		}
	});

	function handleBeforeUnload(event: BeforeUnloadEvent) {
		if (isDirty) {
			event.preventDefault();
		}
	}

	function statusLabel(current: QuizStatus): string {
		if (current === 'published') return 'Published';
		if (current === 'archived') return 'Archived';
		return 'Draft';
	}

	let uploadingImageQuestionIndex = $state<number | null>(null);
	let uploadErrorByQuestionIndex = $state<Record<number, string>>({});

	async function handleImageUpload(questionIndex: number, event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		uploadErrorByQuestionIndex[questionIndex] = '';
		uploadingImageQuestionIndex = questionIndex;

		try {
			const formData = new FormData();
			formData.append('file', file);

			const response = await fetch('/api/images', {
				method: 'POST',
				body: formData
			});

			if (!response.ok) {
				const error = await readApiError(response);
				uploadErrorByQuestionIndex[questionIndex] = error.message;
				return;
			}

			const data = (await response.json()) as { url: string };
			if (questions[questionIndex]) {
				questions[questionIndex].imageUrl = data.url;
			}
		} catch {
			uploadErrorByQuestionIndex[questionIndex] = 'Failed to upload image. Please try again.';
		} finally {
			uploadingImageQuestionIndex = null;
			input.value = '';
		}
	}

	function removeQuestionImage(questionIndex: number) {
		if (isArchived) return;
		if (questions[questionIndex]) {
			questions[questionIndex].imageUrl = null;
			uploadErrorByQuestionIndex[questionIndex] = '';
		}
	}

	function addQuestion() {
		if (isArchived || questions.length >= QUIZ_LIMITS.maxQuestions) return;
		questions.push({
			key: crypto.randomUUID(),
			text: '',
			imageUrl: null,
			timeLimitSeconds: QUIZ_LIMITS.defaultTimeLimitSeconds,
			points: QUIZ_LIMITS.defaultPoints,
			options: [
				{ key: crypto.randomUUID(), text: '', isCorrect: true },
				{ key: crypto.randomUUID(), text: '', isCorrect: false },
				{ key: crypto.randomUUID(), text: '', isCorrect: false },
				{ key: crypto.randomUUID(), text: '', isCorrect: false }
			]
		});
	}

	function removeQuestion(index: number) {
		if (isArchived) return;
		questions.splice(index, 1);
	}

	function moveQuestion(index: number, direction: -1 | 1) {
		if (isArchived) return;
		const target = index + direction;
		if (target < 0 || target >= questions.length) return;
		const current = questions[index];
		const swap = questions[target];
		if (!current || !swap) return;
		questions[index] = swap;
		questions[target] = current;
	}

	function addOption(questionIndex: number) {
		if (isArchived) return;
		const question = questions[questionIndex];
		if (!question || question.options.length >= QUIZ_LIMITS.maxOptions) return;
		question.options.push({
			key: crypto.randomUUID(),
			text: '',
			isCorrect: false
		});
	}

	function removeOption(questionIndex: number, optionIndex: number) {
		if (isArchived) return;
		const question = questions[questionIndex];
		if (!question || question.options.length <= QUIZ_LIMITS.minOptions) return;
		const removed = question.options.splice(optionIndex, 1)[0];
		if (removed?.isCorrect && question.options[0]) {
			question.options[0].isCorrect = true;
		}
	}

	function selectCorrectOption(questionIndex: number, optionIndex: number) {
		if (isArchived) return;
		const question = questions[questionIndex];
		if (!question) return;
		for (let idx = 0; idx < question.options.length; idx += 1) {
			const option = question.options[idx];
			if (option) {
				option.isCorrect = idx === optionIndex;
			}
		}
	}

	function toQuestionInputs(): QuizQuestionInput[] {
		return questions.map((question) => ({
			text: question.text,
			imageUrl: question.imageUrl ?? null,
			timeLimitSeconds: Number(question.timeLimitSeconds),
			points: Number(question.points),
			options: question.options.map((option) => ({
				text: option.text,
				isCorrect: option.isCorrect
			}))
		}));
	}

	function applyServerQuiz(quiz: QuizDetail) {
		title = quiz.title;
		description = quiz.description ?? '';
		status = quiz.status;
		questions = toEditableQuestions(quiz);
		savedSnapshot = snapshotPayload(quiz.title, quiz.description ?? '', questions);
	}

	async function saveQuizInternal(): Promise<boolean> {
		formError = '';
		fieldErrors = {};

		const response = await fetch(`/api/quizzes/${encodeURIComponent(data.quiz.id)}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				title,
				description: description || null,
				questions: toQuestionInputs()
			})
		});

		if (!response.ok) {
			const apiError = await readApiError(response);
			formError = apiError.message;
			fieldErrors = apiError.fields;
			return false;
		}

		const body = (await response.json()) as { quiz: QuizDetail };
		applyServerQuiz(body.quiz);
		return true;
	}

	async function handleSave(event: SubmitEvent) {
		event.preventDefault();
		if (saving || publishing || isArchived) return;

		saving = true;
		statusNotice = '';
		try {
			const ok = await saveQuizInternal();
			if (ok) {
				statusNotice = 'Changes saved.';
				await invalidateAll();
			}
		} catch {
			formError = 'Could not reach the server. Try again.';
		} finally {
			saving = false;
		}
	}

	async function handlePublish() {
		if (saving || publishing || isArchived) return;

		publishing = true;
		formError = '';
		statusNotice = '';
		fieldErrors = {};

		try {
			const saved = await saveQuizInternal();
			if (!saved) return;

			const response = await fetch(`/api/quizzes/${encodeURIComponent(data.quiz.id)}/publish`, {
				method: 'POST'
			});

			if (!response.ok) {
				const apiError = await readApiError(response);
				formError = apiError.message;
				fieldErrors = apiError.fields;
				return;
			}

			const body = (await response.json()) as { quiz: QuizDetail };
			applyServerQuiz(body.quiz);
			statusNotice = 'Quiz published and ready to host.';
			await invalidateAll();
		} catch {
			formError = 'Could not reach the server. Try again.';
		} finally {
			publishing = false;
		}
	}

	async function handleStartSession(openQr: boolean = false) {
		if (hosting || saving || publishing || status !== 'published') return;

		hosting = true;
		formError = '';
		statusNotice = '';

		try {
			if (isDirty) {
				const saved = await saveQuizInternal();
				if (!saved) return;
			}

			const response = await fetch(`/api/quizzes/${encodeURIComponent(data.quiz.id)}/sessions`, {
				method: 'POST'
			});
			if (!response.ok) {
				const apiError = await readApiError(response);
				formError = apiError.message;
				return;
			}
			const body = (await response.json()) as { session: { id: string } };
			const basePath = resolve('/(teacher)/sessions/[sessionId]', { sessionId: body.session.id });
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			await goto(openQr ? `${basePath}?qr=1` : basePath);
		} catch {
			formError = 'Could not reach the server. Try again.';
		} finally {
			hosting = false;
		}
	}

	async function handleArchive() {
		if (archiving || isArchived) return;

		archiving = true;
		formError = '';
		statusNotice = '';

		try {
			const response = await fetch(`/api/quizzes/${encodeURIComponent(data.quiz.id)}/archive`, {
				method: 'POST'
			});

			if (!response.ok) {
				const apiError = await readApiError(response);
				formError = apiError.message;
				return;
			}

			const body = (await response.json()) as { quiz: QuizDetail };
			applyServerQuiz(body.quiz);
			confirmingArchive = false;
			statusNotice = 'Quiz archived.';
			await invalidateAll();
		} catch {
			formError = 'Could not reach the server. Try again.';
		} finally {
			archiving = false;
		}
	}

	async function handleDelete() {
		if (deleting) return;

		deleting = true;
		formError = '';

		try {
			const response = await fetch(`/api/quizzes/${encodeURIComponent(data.quiz.id)}`, {
				method: 'DELETE'
			});

			if (!response.ok) {
				const apiError = await readApiError(response);
				formError = apiError.message;
				return;
			}

			savedSnapshot = snapshotPayload(title, description, questions);
			await goto(resolve('/(teacher)/dashboard'), { invalidateAll: true });
		} catch {
			formError = 'Could not reach the server. Try again.';
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:window onbeforeunload={handleBeforeUnload} />

<svelte:head>
	<title>{title || 'Edit quiz'} — {BRAND.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<SiteHeader teacher={data.teacher} />

	<main class="editor-main">
		<div class="editor-topbar">
			<a class="nav-link" href={resolve('/(teacher)/dashboard')}>← Back to dashboard</a>
			<div class="editor-badges">
				<span class="status-badge status-{status}">Status: {statusLabel(status)}</span>
				{#if !isArchived}
					<span class="dirty-badge" data-dirty={isDirty}>
						{isDirty ? 'Unsaved changes' : 'All changes saved'}
					</span>
				{/if}
			</div>
		</div>

		{#if isArchived}
			<div class="archived-banner" role="status">
				<strong>This quiz is archived.</strong> Archived quizzes are read-only and cannot be edited or
				published.
			</div>
		{/if}

		{#if formError}
			<p class="form-error" role="alert">{formError}</p>
		{/if}

		{#if statusNotice}
			<p class="status-notice" role="status">{statusNotice}</p>
		{/if}

		<form class="editor-form" onsubmit={handleSave} novalidate>
			<section class="panel editor-section" aria-labelledby="quiz-details-heading">
				<h1 id="quiz-details-heading">Quiz details</h1>

				<div class="field">
					<label for="quiz-title">Title</label>
					<input
						id="quiz-title"
						name="title"
						type="text"
						maxlength={QUIZ_LIMITS.maxTitleLength}
						bind:value={title}
						disabled={isArchived}
						aria-invalid={fieldErrors.title ? 'true' : undefined}
						required
					/>
					{#if fieldErrors.title}
						<p class="field-error">{fieldErrors.title}</p>
					{/if}
				</div>

				<div class="field">
					<label for="quiz-description">Description (optional)</label>
					<textarea
						id="quiz-description"
						name="description"
						rows="2"
						maxlength={QUIZ_LIMITS.maxDescriptionLength}
						bind:value={description}
						disabled={isArchived}
						aria-invalid={fieldErrors.description ? 'true' : undefined}></textarea>
					{#if fieldErrors.description}
						<p class="field-error">{fieldErrors.description}</p>
					{/if}
				</div>
			</section>

			<section class="questions-section" aria-labelledby="questions-heading">
				<div class="questions-header">
					<div>
						<h2 id="questions-heading">Questions ({questions.length})</h2>
						<p class="field-hint">
							Each question requires {QUIZ_LIMITS.minOptions}–{QUIZ_LIMITS.maxOptions} options and exactly
							one correct answer.
						</p>
					</div>
					{#if !isArchived}
						<button
							class="button button-secondary"
							type="button"
							onclick={addQuestion}
							disabled={questions.length >= QUIZ_LIMITS.maxQuestions}
						>
							+ Add question
						</button>
					{/if}
				</div>

				{#if fieldErrors.questions}
					<p class="form-error" role="alert">{fieldErrors.questions}</p>
				{/if}

				{#if questions.length === 0}
					<div class="panel empty-questions">
						<p>No questions yet. Add at least one question before publishing this quiz.</p>
						{#if !isArchived}
							<button class="button button-primary" type="button" onclick={addQuestion}>
								+ Add first question
							</button>
						{/if}
					</div>
				{:else}
					<ol class="question-list">
						{#each questions as question, qIndex (question.key)}
							<li class="panel question-card">
								<div class="question-card-header">
									<h3>Question {qIndex + 1}</h3>
									{#if !isArchived}
										<div class="question-controls">
											<button
												class="button button-secondary button-small"
												type="button"
												onclick={() => moveQuestion(qIndex, -1)}
												disabled={qIndex === 0}
												aria-label="Move question {qIndex + 1} up"
											>
												↑ Move up
											</button>
											<button
												class="button button-secondary button-small"
												type="button"
												onclick={() => moveQuestion(qIndex, 1)}
												disabled={qIndex === questions.length - 1}
												aria-label="Move question {qIndex + 1} down"
											>
												↓ Move down
											</button>
											<button
												class="button button-secondary button-small"
												type="button"
												onclick={() => removeQuestion(qIndex)}
											>
												Remove question
											</button>
										</div>
									{/if}
								</div>

								<div class="field">
									<label for="question-text-{question.key}">Question prompt</label>
									<input
										id="question-text-{question.key}"
										type="text"
										maxlength={QUIZ_LIMITS.maxQuestionTextLength}
										placeholder="Ask a clear multiple-choice question"
										bind:value={question.text}
										disabled={isArchived}
										aria-invalid={fieldErrors[`questions.${qIndex}.text`] ? 'true' : undefined}
										required
									/>
									{#if fieldErrors[`questions.${qIndex}.text`]}
										<p class="field-error">{fieldErrors[`questions.${qIndex}.text`]}</p>
									{/if}
								</div>

								<div class="question-image-box">
									<span class="image-box-label">Question image (optional)</span>
									{#if question.imageUrl}
										<div class="image-preview-card">
											<img
												src={question.imageUrl}
												alt="Question illustration preview"
												class="image-preview-thumb"
											/>
											{#if !isArchived}
												<div class="image-preview-actions">
													<label class="button button-secondary button-small image-upload-label">
														Replace image
														<input
															type="file"
															accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
															onchange={(e) => handleImageUpload(qIndex, e)}
															disabled={uploadingImageQuestionIndex === qIndex}
															class="sr-only"
														/>
													</label>
													<button
														class="button button-secondary button-small button-danger-text"
														type="button"
														onclick={() => removeQuestionImage(qIndex)}
														disabled={uploadingImageQuestionIndex === qIndex}
													>
														Remove image
													</button>
												</div>
											{/if}
										</div>
									{:else if !isArchived}
										<div class="image-upload-empty">
											<label class="button button-secondary button-small image-upload-label">
												{#if uploadingImageQuestionIndex === qIndex}
													Uploading image...
												{:else}
													🖼️ Upload image
												{/if}
												<input
													type="file"
													accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
													onchange={(e) => handleImageUpload(qIndex, e)}
													disabled={uploadingImageQuestionIndex === qIndex}
													class="sr-only"
												/>
											</label>
											<span class="image-hint">PNG, JPG, WebP, GIF or SVG up to 3MB</span>
										</div>
									{/if}
									{#if uploadErrorByQuestionIndex[qIndex]}
										<p class="field-error" role="alert">{uploadErrorByQuestionIndex[qIndex]}</p>
									{/if}
								</div>

								<div class="question-settings-grid">
									<div class="field">
										<label for="question-time-{question.key}">
											Time limit ({QUIZ_LIMITS.minTimeLimitSeconds}–{QUIZ_LIMITS.maxTimeLimitSeconds}s)
										</label>
										<input
											id="question-time-{question.key}"
											type="number"
											min={QUIZ_LIMITS.minTimeLimitSeconds}
											max={QUIZ_LIMITS.maxTimeLimitSeconds}
											step="1"
											bind:value={question.timeLimitSeconds}
											disabled={isArchived}
											aria-invalid={fieldErrors[`questions.${qIndex}.timeLimitSeconds`]
												? 'true'
												: undefined}
										/>
										{#if fieldErrors[`questions.${qIndex}.timeLimitSeconds`]}
											<p class="field-error">
												{fieldErrors[`questions.${qIndex}.timeLimitSeconds`]}
											</p>
										{/if}
									</div>

									<div class="field">
										<label for="question-points-{question.key}">
											Points ({QUIZ_LIMITS.minPoints}–{QUIZ_LIMITS.maxPoints})
										</label>
										<input
											id="question-points-{question.key}"
											type="number"
											min={QUIZ_LIMITS.minPoints}
											max={QUIZ_LIMITS.maxPoints}
											step="1"
											bind:value={question.points}
											disabled={isArchived}
											aria-invalid={fieldErrors[`questions.${qIndex}.points`] ? 'true' : undefined}
										/>
										{#if fieldErrors[`questions.${qIndex}.points`]}
											<p class="field-error">{fieldErrors[`questions.${qIndex}.points`]}</p>
										{/if}
									</div>
								</div>

								<div class="options-block">
									<div class="options-header">
										<span class="options-title">Answer options</span>
										{#if !isArchived}
											<button
												class="button button-secondary button-small"
												type="button"
												onclick={() => addOption(qIndex)}
												disabled={question.options.length >= QUIZ_LIMITS.maxOptions}
											>
												+ Add option
											</button>
										{/if}
									</div>

									{#if fieldErrors[`questions.${qIndex}.options`]}
										<p class="field-error">{fieldErrors[`questions.${qIndex}.options`]}</p>
									{/if}

									<div class="options-list">
										{#each question.options as option, oIndex (option.key)}
											<div class="option-row" data-correct={option.isCorrect}>
												<label class="correct-toggle">
													<input
														type="radio"
														name="correct-option-{question.key}"
														checked={option.isCorrect}
														onchange={() => selectCorrectOption(qIndex, oIndex)}
														disabled={isArchived}
													/>
													<span>
														{option.isCorrect ? '✓ Correct' : 'Mark correct'}
													</span>
												</label>

												<div class="option-input-wrap">
													<input
														type="text"
														maxlength={QUIZ_LIMITS.maxOptionTextLength}
														placeholder="Option {oIndex + 1}"
														aria-label="Question {qIndex + 1} option {oIndex + 1}"
														bind:value={option.text}
														disabled={isArchived}
														aria-invalid={fieldErrors[`questions.${qIndex}.options.${oIndex}.text`]
															? 'true'
															: undefined}
														required
													/>
													{#if fieldErrors[`questions.${qIndex}.options.${oIndex}.text`]}
														<p class="field-error">
															{fieldErrors[`questions.${qIndex}.options.${oIndex}.text`]}
														</p>
													{/if}
												</div>

												{#if !isArchived}
													<button
														class="button button-secondary button-small"
														type="button"
														onclick={() => removeOption(qIndex, oIndex)}
														disabled={question.options.length <= QUIZ_LIMITS.minOptions}
														aria-label="Remove option {oIndex + 1}"
													>
														Remove
													</button>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							</li>
						{/each}
					</ol>
				{/if}
			</section>

			<section class="panel editor-footer-bar" aria-label="Quiz actions">
				<div class="primary-actions">
					{#if !isArchived}
						<button class="button button-primary" type="submit" disabled={saving || publishing}>
							{saving ? 'Saving…' : 'Save changes'}
						</button>

						<button
							class="button button-secondary"
							type="button"
							onclick={handlePublish}
							disabled={saving || publishing || hosting}
						>
							{publishing
								? 'Publishing…'
								: status === 'published'
									? 'Save & republish'
									: 'Save & publish'}
						</button>

						{#if status === 'published'}
							<button
								class="button button-secondary"
								type="button"
								onclick={() => handleStartSession(false)}
								disabled={saving || publishing || hosting}
							>
								{hosting ? 'Opening lobby…' : 'Host live session'}
							</button>
							<button
								class="button button-secondary"
								type="button"
								onclick={() => handleStartSession(true)}
								disabled={saving || publishing || hosting}
							>
								Share QR code
							</button>
						{/if}
					{/if}
				</div>

				<div class="secondary-actions">
					{#if !isArchived}
						{#if confirmingArchive}
							<div class="confirm-inline" role="group" aria-label="Confirm archive">
								<span>Archive this quiz?</span>
								<button
									class="button button-secondary button-small"
									type="button"
									onclick={handleArchive}
									disabled={archiving}
								>
									Confirm archive
								</button>
								<button
									class="button button-secondary button-small"
									type="button"
									onclick={() => (confirmingArchive = false)}
									disabled={archiving}
								>
									Cancel
								</button>
							</div>
						{:else}
							<button
								class="button button-secondary"
								type="button"
								onclick={() => {
									confirmingDelete = false;
									confirmingArchive = true;
								}}
							>
								Archive quiz
							</button>
						{/if}
					{/if}

					{#if confirmingDelete}
						<div class="confirm-inline" role="group" aria-label="Confirm delete">
							<span>Delete this quiz permanently?</span>
							<button
								class="button button-danger button-small"
								type="button"
								onclick={handleDelete}
								disabled={deleting}
							>
								Confirm delete
							</button>
							<button
								class="button button-secondary button-small"
								type="button"
								onclick={() => (confirmingDelete = false)}
								disabled={deleting}
							>
								Cancel
							</button>
						</div>
					{:else}
						<button
							class="button button-secondary"
							type="button"
							onclick={() => {
								confirmingArchive = false;
								confirmingDelete = true;
							}}
						>
							Delete quiz
						</button>
					{/if}
				</div>
			</section>
		</form>
	</main>

	<footer class="site-footer">
		<p>{BRAND.name} · {BRAND.tagline}</p>
	</footer>
</div>

<style>
	.editor-main {
		display: grid;
		gap: var(--space-5);
		padding-block: var(--space-5) var(--space-7);
	}

	.editor-topbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.editor-badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.status-badge,
	.dirty-badge {
		display: inline-flex;
		align-items: center;
		border-radius: var(--radius-pill);
		padding: 0.25rem 0.75rem;
		font-size: 0.8rem;
		font-weight: 800;
	}

	.status-draft {
		border: 1px solid #d9b424;
		background: #fff7d1;
		color: var(--color-ink);
	}

	.status-published {
		border: 1px solid #1d9a65;
		background: #e3faef;
		color: #0e5a3a;
	}

	.status-archived {
		border: 1px solid var(--color-border);
		background: var(--color-tint);
		color: var(--color-muted);
	}

	.dirty-badge {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-muted);
	}

	.dirty-badge[data-dirty='true'] {
		border-color: var(--color-energy);
		background: #fff2ec;
		color: #9a3412;
	}

	.archived-banner {
		border-left: 4px solid var(--color-muted);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		background: var(--color-surface);
		padding: var(--space-4);
	}

	.status-notice {
		border: 1px solid #1d9a65;
		border-radius: var(--radius-sm);
		background: #e3faef;
		padding: var(--space-3);
		color: #0e5a3a;
		font-size: 0.9rem;
		font-weight: 700;
	}

	.editor-form {
		display: grid;
		gap: var(--space-5);
	}

	.editor-section {
		display: grid;
		gap: var(--space-4);
		width: 100%;
	}

	.editor-section h1 {
		margin-top: 0;
		font-size: 1.75rem;
	}

	.field textarea {
		width: 100%;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: #fbfcff;
		padding: 0.75rem 0.85rem;
		color: var(--color-ink);
		font: inherit;
		resize: vertical;
	}

	.questions-section {
		display: grid;
		gap: var(--space-4);
	}

	.questions-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.empty-questions {
		display: grid;
		justify-items: start;
		gap: var(--space-3);
		width: 100%;
	}

	.question-list {
		display: grid;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.question-card {
		display: grid;
		gap: var(--space-4);
		width: 100%;
	}

	.question-card-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.question-controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.question-settings-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: var(--space-4);
	}

	.options-block {
		display: grid;
		gap: var(--space-3);
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-4);
	}

	.options-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.options-title {
		font-size: 0.9rem;
		font-weight: 800;
	}

	.options-list {
		display: grid;
		gap: var(--space-3);
	}

	.option-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: start;
		gap: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: #fbfcff;
		padding: var(--space-3);
	}

	.option-row[data-correct='true'] {
		border-color: var(--color-success);
		background: #f0fdf7;
	}

	.correct-toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		font-size: 0.85rem;
		font-weight: 800;
		cursor: pointer;
	}

	.option-input-wrap {
		display: grid;
		gap: var(--space-1);
	}

	.option-input-wrap input {
		width: 100%;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		padding: 0.65rem 0.8rem;
		color: var(--color-ink);
		font: inherit;
	}

	.button-small {
		min-height: 2.25rem;
		padding: 0.4rem 0.8rem;
		font-size: 0.85rem;
	}

	.button-danger {
		border-color: var(--color-danger);
		background: var(--color-danger);
		color: var(--color-surface);
	}

	.editor-footer-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		width: 100%;
	}

	.primary-actions,
	.secondary-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
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
		font-size: 0.85rem;
		font-weight: 700;
	}

	.question-image-box {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.image-box-label {
		color: var(--color-ink);
		font-size: 0.88rem;
		font-weight: 700;
	}

	.image-preview-card {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-3);
	}

	.image-preview-thumb {
		max-width: 12rem;
		max-height: 8rem;
		border-radius: var(--radius-sm);
		object-fit: contain;
		background: #ffffff;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.image-preview-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.image-upload-empty {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.image-upload-label {
		display: inline-flex;
		align-items: center;
		cursor: pointer;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.image-hint {
		color: var(--color-muted);
		font-size: 0.82rem;
	}

	.button-danger-text {
		color: var(--color-danger);
	}

	@media (max-width: 44rem) {
		.option-row {
			grid-template-columns: 1fr;
		}
	}
</style>
