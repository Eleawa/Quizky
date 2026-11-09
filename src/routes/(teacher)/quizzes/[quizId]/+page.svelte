<script lang="ts">
	import { tick } from 'svelte';
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import QuestionText from '#lib/components/QuestionText.svelte';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import EnergyIcon from '#lib/components/EnergyIcon.svelte';
	import { readApiError } from '#lib/shared/api-error.js';
	import { BRAND } from '#lib/shared/brand.js';
	import {
		combineQuestionPromptAndCode,
		splitQuestionPromptAndCode
	} from '#lib/shared/code-highlight.js';
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
		code: string;
		codeLanguage: string;
		editingCode: boolean;
		imageUrl: string | null;
		timeLimitSeconds: number;
		points: number;
		options: EditableOption[];
	}

	function toEditableQuestions(quiz: QuizDetail): EditableQuestion[] {
		return quiz.questions.map((question) => {
			const split = splitQuestionPromptAndCode(question.text);
			return {
				key: question.id,
				text: split.promptText,
				code: split.code,
				codeLanguage: split.language,
				editingCode: false,
				imageUrl: question.imageUrl ?? null,
				timeLimitSeconds: question.timeLimitSeconds,
				points: question.points,
				options: question.options.map((option) => ({
					key: option.id,
					text: option.text,
					isCorrect: option.isCorrect
				}))
			};
		});
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
				text: combineQuestionPromptAndCode(
					question.text,
					question.code,
					question.codeLanguage
				).trim(),
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
	let isPublic = $state(initial.isPublic ?? false);
	let questions = $state<EditableQuestion[]>(toEditableQuestions(initial));
	let savedSnapshot = $state(
		snapshotPayload(initial.title, initial.description ?? '', toEditableQuestions(initial))
	);

	let saving = $state(false);
	let publishing = $state(false);
	let sharing = $state(false);
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

	let showAiGenerator = $state(false);
	let aiPrompt = $state('');
	let aiQuestionCount = $state(5);
	let aiDifficulty = $state<'easy' | 'medium' | 'hard'>('medium');
	let aiGenerating = $state(false);
	let aiError = $state('');

	async function handleGenerateWithAi() {
		if (aiGenerating || isArchived) return;
		const cleanPrompt = aiPrompt.trim();
		if (cleanPrompt.length < 3) {
			aiError = 'Enter a topic or prompt (at least 3 characters).';
			return;
		}
		const remainingSlots = QUIZ_LIMITS.maxQuestions - questions.length;
		if (remainingSlots <= 0) {
			aiError = `This quiz already has the maximum of ${QUIZ_LIMITS.maxQuestions} questions.`;
			return;
		}

		aiGenerating = true;
		aiError = '';
		statusNotice = '';

		try {
			const countToRequest = Math.min(aiQuestionCount, remainingSlots, 15);
			const response = await fetch('/api/quizzes/generate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					prompt: cleanPrompt,
					count: countToRequest,
					difficulty: aiDifficulty,
					timeLimitSeconds: QUIZ_LIMITS.defaultTimeLimitSeconds,
					points: QUIZ_LIMITS.defaultPoints
				})
			});

			if (!response.ok) {
				const apiError = await readApiError(response);
				aiError = apiError.message;
				return;
			}

			const body = (await response.json()) as { questions: QuizQuestionInput[] };
			let firstAddedKey: string | null = null;
			for (const q of body.questions) {
				if (questions.length >= QUIZ_LIMITS.maxQuestions) break;
				const qKey = crypto.randomUUID();
				if (!firstAddedKey) firstAddedKey = qKey;
				const split = splitQuestionPromptAndCode(q.text);
				questions.push({
					key: qKey,
					text: split.promptText,
					code: split.code,
					codeLanguage: split.language,
					editingCode: false,
					imageUrl: q.imageUrl ?? null,
					timeLimitSeconds: q.timeLimitSeconds,
					points: q.points,
					options: q.options.map((opt) => ({
						key: crypto.randomUUID(),
						text: opt.text,
						isCorrect: opt.isCorrect
					}))
				});
			}

			statusNotice = `Generated ${body.questions.length} ${body.questions.length === 1 ? 'question' : 'questions'} with AI. Review and save when ready.`;
			showAiGenerator = false;
			aiPrompt = '';

			if (firstAddedKey) {
				await tick();
				const el = document.getElementById(`question-text-${firstAddedKey}`);
				el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		} catch {
			aiError = 'Could not reach the server to generate questions. Try again.';
		} finally {
			aiGenerating = false;
		}
	}

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

			const uploaded = (await response.json()) as { url: string };
			if (questions[questionIndex]) {
				questions[questionIndex].imageUrl = uploaded.url;
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

	async function addQuestion() {
		if (isArchived || questions.length >= QUIZ_LIMITS.maxQuestions) return;
		const newKey = crypto.randomUUID();
		questions.push({
			key: newKey,
			text: '',
			code: '',
			codeLanguage: '',
			editingCode: false,
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
		await tick();
		const input = document.getElementById(`question-text-${newKey}`) as HTMLTextAreaElement | null;
		input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		input?.focus({ preventScroll: true });
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
			text: combineQuestionPromptAndCode(question.text, question.code, question.codeLanguage),
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
		isPublic = quiz.isPublic ?? false;
		questions = toEditableQuestions(quiz);
		savedSnapshot = snapshotPayload(quiz.title, quiz.description ?? '', questions);
	}

	async function handleToggleShare(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		const nextState = target.checked;
		if (sharing || status !== 'published' || isArchived) return;

		sharing = true;
		formError = '';
		statusNotice = '';
		try {
			const response = await fetch(`/api/quizzes/${encodeURIComponent(data.quiz.id)}/share`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ isPublic: nextState })
			});

			if (!response.ok) {
				const apiError = await readApiError(response);
				formError = apiError.message;
				target.checked = !nextState;
				return;
			}

			const body = (await response.json()) as { quiz: QuizDetail };
			isPublic = body.quiz.isPublic;
			statusNotice = isPublic
				? 'Quiz is now shared in the Community Library.'
				: 'Quiz is no longer shared in the Community Library.';
			await invalidateAll();
		} catch {
			formError = 'Could not update library sharing settings.';
			target.checked = !nextState;
		} finally {
			sharing = false;
		}
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
				isPublic,
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
	<title>{title || 'Edit quiz'} · {BRAND.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<SiteHeader teacher={data.teacher} />

	<main class="editor-main">
		<div class="editor-topbar">
			<a class="nav-link" href={resolve('/(teacher)/dashboard')}
				><EnergyIcon name="arrow-left" /> Back to dashboard</a
			>
			<div class="editor-badges">
				<span class="status-badge status-{status}">Status: {statusLabel(status)}</span>
				{#if isPublic}
					<span class="status-badge status-shared"
						><EnergyIcon name="check" /> Shared in Library</span
					>
				{/if}
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

				{#if status === 'published'}
					<div class="field share-field">
						<label class="checkbox-field">
							<input
								type="checkbox"
								checked={isPublic}
								disabled={isArchived || sharing}
								onchange={handleToggleShare}
							/>
							<span>Share with other teachers in Community Library</span>
						</label>
						{#if isPublic}
							<p class="field-hint" style="color: var(--gruv-green);">
								This quiz is listed in the Community Library for other teachers to browse and clone.
							</p>
						{:else}
							<p class="field-hint">Check this box to share your quiz in the Community Library.</p>
						{/if}
					</div>
				{:else if !isArchived}
					<div class="field share-field">
						<p class="field-hint">
							Publish this quiz to share it with other teachers in the Community Library.
						</p>
					</div>
				{/if}
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
						<div class="questions-header-actions">
							<button
								class="button button-secondary"
								type="button"
								onclick={() => {
									showAiGenerator = !showAiGenerator;
									aiError = '';
								}}
								disabled={questions.length >= QUIZ_LIMITS.maxQuestions}
							>
								<EnergyIcon name="ai-sparkle" />
								{showAiGenerator ? 'Hide AI generator' : 'Generate with AI'}
							</button>
							<button
								class="button button-secondary"
								type="button"
								onclick={addQuestion}
								disabled={questions.length >= QUIZ_LIMITS.maxQuestions}
							>
								<EnergyIcon name="plus" /> Add question
							</button>
						</div>
					{/if}
				</div>

				{#if !isArchived && showAiGenerator}
					<div class="panel ai-generator-panel" role="region" aria-labelledby="ai-gen-heading">
						<div class="ai-generator-header">
							<div>
								<h3 id="ai-gen-heading">
									<EnergyIcon name="ai-sparkle" /> Generate questions with AI
								</h3>
								<p class="field-hint">
									Describe a topic, grade level, or paste study notes and Cloudflare Workers AI will
									draft multiple-choice questions for you.
								</p>
							</div>
						</div>

						{#if aiError}
							<p class="form-error" role="alert">{aiError}</p>
						{/if}

						<div class="field">
							<label for="ai-prompt-input">Topic or prompt</label>
							<textarea
								id="ai-prompt-input"
								rows="3"
								maxlength="2000"
								placeholder="e.g. Photosynthesis and plant cells for 8th grade biology, or paste your lesson notes here…"
								bind:value={aiPrompt}
								disabled={aiGenerating}></textarea>
						</div>

						<div class="ai-generator-controls">
							<div class="field">
								<label for="ai-count-select">Number of questions</label>
								<select
									id="ai-count-select"
									class="ai-select"
									bind:value={aiQuestionCount}
									disabled={aiGenerating}
								>
									<option value={3}>3 questions</option>
									<option value={5}>5 questions</option>
									<option value={8}>8 questions</option>
									<option value={10}>10 questions</option>
								</select>
							</div>

							<div class="field">
								<label for="ai-difficulty-select">Difficulty</label>
								<select
									id="ai-difficulty-select"
									class="ai-select"
									bind:value={aiDifficulty}
									disabled={aiGenerating}
								>
									<option value="easy">Easy</option>
									<option value="medium">Medium</option>
									<option value="hard">Hard</option>
								</select>
							</div>

							<div class="ai-generator-submit">
								<button
									class="button button-primary"
									type="button"
									onclick={handleGenerateWithAi}
									disabled={aiGenerating || aiPrompt.trim().length < 3}
								>
									{#if aiGenerating}
										<span class="gruv-spinner" aria-hidden="true"></span>
									{:else}
										<EnergyIcon name="ai-sparkle" />
									{/if}
									{aiGenerating ? 'Generating with AI…' : 'Generate questions'}
								</button>
							</div>
						</div>
					</div>
				{/if}

				{#if fieldErrors.questions}
					<p class="form-error" role="alert">{fieldErrors.questions}</p>
				{/if}

				{#if questions.length === 0}
					<div class="panel empty-questions">
						<p>No questions yet. Add at least one question before publishing this quiz.</p>
						{#if !isArchived}
							<div class="questions-header-actions">
								<button class="button button-primary" type="button" onclick={addQuestion}>
									<EnergyIcon name="plus" /> Add first question
								</button>
								<button
									class="button button-secondary"
									type="button"
									onclick={() => {
										showAiGenerator = true;
										aiError = '';
									}}
								>
									<EnergyIcon name="ai-sparkle" /> Generate with AI
								</button>
							</div>
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
												<EnergyIcon name="arrow-up" /> Move up
											</button>
											<button
												class="button button-secondary button-small"
												type="button"
												onclick={() => moveQuestion(qIndex, 1)}
												disabled={qIndex === questions.length - 1}
												aria-label="Move question {qIndex + 1} down"
											>
												<EnergyIcon name="arrow-down" /> Move down
											</button>
											<button
												class="button button-secondary button-small"
												type="button"
												onclick={() => removeQuestion(qIndex)}
											>
												<EnergyIcon name="trash" /> Remove question
											</button>
										</div>
									{/if}
								</div>

								<div class="field">
									<div class="field-label-row">
										<label for="question-text-{question.key}">Question prompt</label>
										{#if !isArchived && !question.code}
											<button
												type="button"
												class="code-block-insert-btn"
												onclick={() => {
													const split = splitQuestionPromptAndCode(question.text);
													if (split.code) {
														question.text = split.promptText;
														question.code = split.code;
														question.codeLanguage = '';
														question.editingCode = false;
													} else {
														if (!question.text.trim()) {
															question.text = 'What is the output of the following code?';
														}
														question.codeLanguage = '';
														question.code = 'x = [1, 2, 3]\nfor n in x:\n  print(n * 2)';
														question.editingCode = true;
													}
												}}
											>
												&lt;/&gt; Add code block
											</button>
										{/if}
									</div>
									<textarea
										id="question-text-{question.key}"
										rows={Math.max(2, Math.min(6, question.text.split('\n').length))}
										maxlength={QUIZ_LIMITS.maxQuestionTextLength}
										placeholder="Ask a clear multiple-choice question"
										bind:value={question.text}
										onblur={() => {
											if (!question.code) {
												const split = splitQuestionPromptAndCode(question.text);
												if (split.code) {
													question.text = split.promptText;
													question.code = split.code;
													question.codeLanguage = '';
												}
											}
										}}
										disabled={isArchived}
										aria-invalid={fieldErrors[`questions.${qIndex}.text`] ? 'true' : undefined}
										required></textarea>
									{#if question.code || splitQuestionPromptAndCode(question.text).code}
										<div class="code-preview-wrapper">
											<div class="code-preview-header">
												<span class="code-preview-label">Syntax highlight preview</span>
												{#if !isArchived && question.code}
													<div class="code-preview-actions">
														<button
															type="button"
															class="code-action-btn"
															onclick={() => {
																question.editingCode = !question.editingCode;
															}}
														>
															{question.editingCode ? 'Done' : 'Edit code'}
														</button>
														<button
															type="button"
															class="code-action-btn code-action-remove"
															onclick={() => {
																question.code = '';
																question.codeLanguage = '';
																question.editingCode = false;
															}}
														>
															Remove
														</button>
													</div>
												{/if}
											</div>
											{#if question.editingCode && !isArchived}
												<textarea
													class="code-editor-textarea"
													rows={Math.max(3, Math.min(10, question.code.split('\n').length))}
													placeholder="Enter code snippet..."
													bind:value={question.code}></textarea>
											{/if}
											<QuestionText
												codeOnly
												headingTag="div"
												text={question.code
													? combineQuestionPromptAndCode(question.text, question.code)
													: question.text}
											/>
										</div>
									{/if}
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
													<EnergyIcon name="image-plus" /> Upload image
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
												<EnergyIcon name="plus" /> Add option
											</button>
										{/if}
									</div>

									{#if fieldErrors[`questions.${qIndex}.options`]}
										<p class="field-error">{fieldErrors[`questions.${qIndex}.options`]}</p>
									{/if}

									<div class="options-list">
										{#each question.options as option, oIndex (option.key)}
											<div class="option-row" data-correct={option.isCorrect}>
												<label class="correct-toggle" data-checked={option.isCorrect}>
													<input
														type="checkbox"
														class="gruv-checkbox"
														name="correct-option-{question.key}"
														checked={option.isCorrect}
														onchange={() => selectCorrectOption(qIndex, oIndex)}
														disabled={isArchived}
													/>
													<span class="correct-toggle-label">
														{option.isCorrect ? 'Correct' : 'Mark correct'}
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

					{#if !isArchived}
						<div class="questions-bottom-actions">
							<button
								class="button button-secondary add-question-bottom-btn"
								type="button"
								onclick={addQuestion}
								disabled={questions.length >= QUIZ_LIMITS.maxQuestions}
							>
								<EnergyIcon name="plus" /> Add question
							</button>
						</div>
					{/if}
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
		align-content: start;
		gap: var(--space-5);
		padding-block: var(--space-6);
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

	.share-field {
		margin-top: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px dashed var(--color-border);
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
		border-color: var(--gruv-orange);
		background: #3b2618;
		color: var(--gruv-orange);
	}

	.archived-banner {
		border-left: 4px solid var(--color-muted);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		background: var(--color-surface);
		padding: var(--space-4);
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
		border: 2px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--gruv-bg-hard);
		padding: 0.75rem 0.85rem;
		color: var(--color-heading);
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

	.questions-header-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.ai-generator-panel {
		display: grid;
		gap: var(--space-4);
		width: 100%;
		border: 1.5px solid var(--color-brand);
		background: var(--color-tint);
	}

	.ai-generator-header h3 {
		font-size: 1.15rem;
	}

	.ai-generator-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-4);
	}

	.ai-select {
		min-width: 10rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		padding: 0.65rem 0.85rem;
		color: var(--color-ink);
		font: inherit;
	}

	.ai-generator-submit {
		margin-left: auto;
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

	.questions-bottom-actions {
		display: flex;
		justify-content: flex-start;
	}

	.add-question-bottom-btn {
		width: 100%;
		border: 1.5px dashed var(--color-brand);
		background: var(--color-surface);
		padding-block: 0.9rem;
		color: var(--color-brand);
		font-weight: 700;
	}

	.add-question-bottom-btn:hover:not(:disabled) {
		background: var(--color-tint);
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
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--gruv-bg1);
		padding: var(--space-3);
	}

	.option-row[data-correct='true'] {
		border-color: var(--gruv-green);
		background: #2b331b;
	}

	.correct-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 2.75rem;
		border: 2px solid var(--gruv-bg3);
		border-radius: var(--radius-sm);
		background: var(--gruv-bg-hard);
		padding: 0.4rem 0.75rem;
		color: var(--color-muted);
		font-size: 0.82rem;
		font-weight: 400;
		box-shadow: 0 2px 0 #141617;
		cursor: pointer;
		user-select: none;
		transition:
			border-color 140ms ease,
			background-color 140ms ease,
			color 140ms ease,
			transform 120ms ease;
	}

	.correct-toggle:hover {
		border-color: var(--gruv-orange);
		color: var(--gruv-fg0);
		transform: translateY(-1px);
	}

	.correct-toggle[data-checked='true'] {
		border-color: var(--gruv-green);
		background: #1f2612;
		color: var(--gruv-green);
	}

	.correct-toggle-label {
		line-height: 1;
		white-space: nowrap;
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
		background: var(--gruv-bg-hard);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
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

	.field-label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.code-block-insert-btn {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-tint);
		padding: 0.18rem 0.55rem;
		font-family: var(--font-mono);
		font-size: 0.76rem;
		font-weight: 700;
		color: var(--color-brand);
		cursor: pointer;
	}

	.code-block-insert-btn:hover {
		border-color: var(--color-brand);
	}

	.code-preview-wrapper {
		display: grid;
		gap: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-3);
	}

	.code-preview-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.code-preview-label {
		font-size: 0.75rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-muted);
	}

	.code-preview-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.code-action-btn {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		padding: 0.15rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-ink);
		cursor: pointer;
	}

	.code-action-btn:hover {
		border-color: var(--color-brand);
	}

	.code-action-remove {
		color: var(--color-danger);
	}

	.code-editor-textarea {
		width: 100%;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--gruv-bg-hard);
		color: var(--gruv-fg1);
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-mono);
		font-size: 0.9rem;
		line-height: 1.5;
		resize: vertical;
	}

	@media (max-width: 44rem) {
		.option-row {
			grid-template-columns: 1fr;
		}
	}
</style>
