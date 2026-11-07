<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { BRAND } from '#lib/shared/brand.js';
	import {
		PROTOCOL_VERSION,
		type GameSessionStatus,
		type GameSummary,
		type PublicParticipant,
		type PublicQuestion,
		type QuestionPhase,
		type RoomSnapshot,
		type StudentQuestionResult
	} from '#lib/shared/session.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function initialSnapshot(): RoomSnapshot {
		return data.snapshot;
	}

	const initial = initialSnapshot();

	let status = $state<GameSessionStatus>(initial.status);
	let questionPhase = $state<QuestionPhase>(initial.questionPhase);
	let participants = $state<PublicParticipant[]>(initial.participants);
	let currentQuestion = $state<PublicQuestion | null>(initial.currentQuestion);
	let hasSubmitted = $state<boolean>(initial.hasSubmittedCurrentQuestion ?? false);
	let selectedOptionId = $state<string | null>(initial.selectedOptionId ?? null);
	let lastQuestionResult = $state<StudentQuestionResult | null>(
		initial.lastQuestionResult?.role === 'student' ? initial.lastQuestionResult : null
	);
	let studentResults = $state<StudentQuestionResult[]>(
		initial.lastQuestionResult?.role === 'student' ? [initial.lastQuestionResult] : []
	);

	function recordStudentResult(res: StudentQuestionResult) {
		const idx = studentResults.findIndex((r) => r.questionId === res.questionId);
		if (idx >= 0) {
			studentResults[idx] = res;
		} else {
			studentResults.push(res);
		}
	}

	let totalEarnedScore = $derived(studentResults.reduce((sum, item) => sum + item.scoreAwarded, 0));
	let correctAnswersCount = $derived(studentResults.filter((item) => item.isCorrect).length);
	let nowMs = $state<number>(Date.now());

	let connectionState = $state<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>(
		'connecting'
	);
	let wsError = $state('');
	let activeSocket: WebSocket | null = null;

	let connectedCount = $derived(
		participants.filter((participant) => participant.status === 'connected').length
	);

	let remainingSeconds = $derived.by(() => {
		if (status !== 'in_progress' || questionPhase !== 'open' || !currentQuestion) return 0;
		const deadlineMs = Date.parse(currentQuestion.deadlineAt);
		if (!Number.isFinite(deadlineMs)) return 0;
		return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
	});

	function upsertParticipant(incoming: PublicParticipant) {
		const index = participants.findIndex((item) => item.id === incoming.id);
		if (index >= 0) {
			participants[index] = incoming;
		} else {
			participants.push(incoming);
		}
	}

	function markParticipantDisconnected(participantId: string) {
		const target = participants.find((item) => item.id === participantId);
		if (target && status !== 'completed') {
			target.status = 'disconnected';
		}
	}

	function submitOption(optionId: string) {
		if (!currentQuestion || hasSubmitted || questionPhase !== 'open' || remainingSeconds <= 0) {
			return;
		}
		if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
			wsError = 'Reconnecting to server. Try again in a moment.';
			return;
		}

		wsError = '';
		selectedOptionId = optionId;
		hasSubmitted = true;

		activeSocket.send(
			JSON.stringify({
				version: PROTOCOL_VERSION,
				type: 'submit_answer',
				questionId: currentQuestion.id,
				optionId,
				requestId: crypto.randomUUID()
			})
		);
	}

	onMount(() => {
		let socket: WebSocket | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let destroyed = false;
		let attempt = 0;

		const clockInterval = setInterval(() => {
			nowMs = Date.now();
		}, 250);

		function connect() {
			if (destroyed) return;
			connectionState = attempt === 0 ? 'connecting' : 'reconnecting';

			let storedToken: string | undefined = data.participantToken ?? undefined;
			if (!storedToken) {
				try {
					storedToken = sessionStorage.getItem(`quizky_pt_${data.session.sessionId}`) ?? undefined;
				} catch {
					storedToken = undefined;
				}
			}

			const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			const tokenParam = storedToken ? `&token=${encodeURIComponent(storedToken)}` : '';
			const wsUrl = `${wsProtocol}//${window.location.host}/api/sessions/${encodeURIComponent(data.session.sessionId)}/ws?role=student${tokenParam}`;

			socket = new WebSocket(wsUrl);
			activeSocket = socket;

			socket.addEventListener('open', () => {
				attempt = 0;
				connectionState = 'connected';
				wsError = '';

				socket?.send(
					JSON.stringify({
						version: PROTOCOL_VERSION,
						type: 'join_session',
						...(storedToken ? { participantToken: storedToken } : {})
					})
				);
			});

			socket.addEventListener('message', (event) => {
				if (typeof event.data !== 'string') return;
				try {
					const message = JSON.parse(event.data) as {
						type?: string;
						payload?: unknown;
					};
					if (message.type === 'room_snapshot' && message.payload) {
						const snap = message.payload as RoomSnapshot;
						status = snap.status;
						questionPhase = snap.questionPhase;
						participants = snap.participants;
						currentQuestion = snap.currentQuestion;
						hasSubmitted = snap.hasSubmittedCurrentQuestion ?? false;
						selectedOptionId = snap.selectedOptionId ?? null;
						if (snap.lastQuestionResult?.role === 'student') {
							lastQuestionResult = snap.lastQuestionResult;
							recordStudentResult(snap.lastQuestionResult);
						}
					} else if (message.type === 'participant_joined' && message.payload) {
						upsertParticipant(message.payload as PublicParticipant);
					} else if (message.type === 'participant_left' && message.payload) {
						const left = message.payload as { participantId: string };
						markParticipantDisconnected(left.participantId);
					} else if (message.type === 'game_started') {
						status = 'in_progress';
					} else if (message.type === 'question_started' && message.payload) {
						const q = message.payload as PublicQuestion;
						status = 'in_progress';
						questionPhase = 'open';
						currentQuestion = q;
						hasSubmitted = false;
						selectedOptionId = null;
						lastQuestionResult = null;
						nowMs = Date.now();
					} else if (message.type === 'question_ended' && message.payload) {
						const res = message.payload as StudentQuestionResult;
						questionPhase = 'closed';
						if (res.role === 'student') {
							lastQuestionResult = res;
							selectedOptionId = res.selectedOptionId;
							recordStudentResult(res);
						}
					} else if (message.type === 'game_completed' && message.payload) {
						const summary = message.payload as GameSummary;
						status = summary.status ?? 'completed';
						questionPhase = 'closed';
					} else if (message.type === 'error' && message.payload) {
						const err = message.payload as { code?: string; message?: string };
						wsError = err.message ?? 'Connection error.';
					}
				} catch {
					// Ignore malformed frame.
				}
			});

			socket.addEventListener('close', () => {
				if (destroyed) return;
				connectionState = 'reconnecting';
				attempt += 1;
				const delayMs = Math.min(1000 * 2 ** Math.min(attempt, 4), 10_000);
				reconnectTimer = setTimeout(connect, delayMs);
			});

			socket.addEventListener('error', () => {
				wsError = 'Connection interrupted. Reconnecting…';
			});
		}

		connect();

		return () => {
			destroyed = true;
			clearInterval(clockInterval);
			if (reconnectTimer) clearTimeout(reconnectTimer);
			socket?.close();
		};
	});
</script>

<svelte:head>
	<title>{data.session.quizTitle} — {BRAND.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<SiteHeader teacher={data.teacher} />

	<main class="play-main">
		<div class="play-topbar">
			<span class="code-pill">
				Room: <strong>{data.session.joinCode}</strong> · Player:
				<strong>{data.participant.nickname}</strong>
			</span>
			<span class="connection-pill" data-state={connectionState} role="status">
				{#if connectionState === 'connected'}
					● Connected
				{:else if connectionState === 'connecting'}
					◌ Connecting…
				{:else}
					◌ Reconnecting…
				{/if}
			</span>
		</div>

		{#if wsError}
			<p class="form-error" role="alert">{wsError}</p>
		{/if}

		{#if status === 'lobby'}
			<section class="panel waiting-card" aria-labelledby="waiting-title">
				<p class="auth-eyebrow">You're in!</p>
				<h1 id="waiting-title">{data.participant.nickname}</h1>
				<p class="waiting-quiz-title">{data.session.quizTitle}</p>

				<div class="waiting-pulse" role="status">
					<span class="pulse-dot" aria-hidden="true"></span>
					<span>Waiting for your teacher to start the game…</span>
				</div>

				<div class="roster-summary">
					<h2>Players ready ({connectedCount})</h2>
					<ul class="roster-pills" aria-live="polite">
						{#each participants as player (player.id)}
							<li
								class="roster-pill"
								data-self={player.id === data.participant.id}
								data-status={player.status}
							>
								{player.nickname}
								{#if player.id === data.participant.id}
									<span class="you-tag">(You)</span>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			</section>
		{:else if status === 'in_progress' && currentQuestion}
			<section class="panel question-card" aria-labelledby="student-question-title">
				<div class="student-question-meta">
					<span class="question-progress-badge">
						Question {currentQuestion.position + 1} of {currentQuestion.totalQuestions}
					</span>
					<span
						class="timer-badge"
						data-phase={questionPhase}
						data-urgent={questionPhase === 'open' && remainingSeconds <= 5}
					>
						{#if questionPhase === 'open'}
							⏱ {remainingSeconds}s
						{:else}
							Time's up
						{/if}
					</span>
				</div>

				<h1 id="student-question-title" class="student-question-text">
					{currentQuestion.text}
				</h1>

				{#if currentQuestion.imageUrl}
					<div class="student-question-media">
						<img
							src={currentQuestion.imageUrl}
							alt="Question illustration"
							class="student-question-image"
						/>
					</div>
				{/if}

				<div class="student-options-list" role="group" aria-label="Answer options">
					{#each currentQuestion.options as option, idx (option.id)}
						<button
							type="button"
							class="student-option-button"
							data-selected={selectedOptionId === option.id}
							data-correct={questionPhase === 'closed' &&
								lastQuestionResult?.correctOptionId === option.id}
							disabled={hasSubmitted || questionPhase !== 'open' || remainingSeconds <= 0}
							onclick={() => submitOption(option.id)}
						>
							<span class="option-letter">{String.fromCharCode(65 + idx)}</span>
							<span class="option-text">{option.text}</span>
						</button>
					{/each}
				</div>

				{#if questionPhase === 'open' && hasSubmitted}
					<div class="submission-banner" role="status">
						<strong>✓ Answer locked in!</strong> Waiting for the question to finish…
					</div>
				{:else if questionPhase === 'closed' && lastQuestionResult}
					<div class="result-banner" data-correct={lastQuestionResult.isCorrect} role="status">
						{#if lastQuestionResult.isCorrect}
							<strong>🎉 Correct! +{lastQuestionResult.scoreAwarded} pts</strong>
						{:else if lastQuestionResult.selectedOptionId === null}
							<strong>⏱ Time expired — 0 pts</strong>
						{:else}
							<strong>✗ Not quite — 0 pts</strong>
						{/if}
						<span>Get ready for the next question…</span>
					</div>
				{/if}
			</section>
		{:else}
			<section class="panel waiting-card" aria-labelledby="completed-title">
				<p class="auth-eyebrow">
					{status === 'cancelled' ? 'Session cancelled' : 'Quiz complete!'}
				</p>
				<h1 id="completed-title">
					{status === 'cancelled'
						? 'This session was cancelled by the teacher.'
						: `Great work, ${data.participant.nickname}!`}
				</h1>
				<p class="waiting-quiz-title">{data.session.quizTitle}</p>

				{#if status === 'completed'}
					<div class="student-score-summary">
						<div class="student-score-box">
							<span class="score-label">Points Earned</span>
							<strong class="score-val">{totalEarnedScore} pts</strong>
						</div>
						<div class="student-score-box">
							<span class="score-label">Correct Answers</span>
							<strong class="score-val">{correctAnswersCount} / {data.session.questionCount}</strong
							>
						</div>
					</div>
					<p class="field-hint">
						All questions have been completed. Look at your teacher's screen for the final review!
					</p>
				{/if}

				<div class="completion-actions">
					<a class="button button-primary" href={resolve('/')}>Join another game</a>
				</div>
			</section>
		{/if}
	</main>

	<footer class="site-footer">
		<p>{BRAND.name} · {BRAND.tagline}</p>
	</footer>
</div>

<style>
	.play-main {
		display: grid;
		justify-items: center;
		gap: var(--space-5);
		padding-block: var(--space-5) var(--space-7);
	}

	.play-topbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: min(100%, 44rem);
	}

	.code-pill,
	.connection-pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		padding: 0.3rem 0.85rem;
		font-size: 0.85rem;
		font-weight: 700;
	}

	.connection-pill[data-state='connected'] {
		border-color: #1d9a65;
		background: #e3faef;
		color: #0e5a3a;
	}

	.connection-pill[data-state='reconnecting'] {
		border-color: var(--color-energy);
		background: #fff2ec;
		color: #9a3412;
	}

	.waiting-card,
	.question-card {
		display: grid;
		gap: var(--space-4);
		width: min(100%, 44rem);
	}

	.waiting-card {
		text-align: center;
	}

	.waiting-quiz-title {
		color: var(--color-muted);
		font-size: 1.15rem;
		font-weight: 700;
	}

	.waiting-pulse {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		border: 2px solid var(--color-sunshine);
		border-radius: var(--radius-md);
		background: #fffbeb;
		padding: var(--space-4);
		font-weight: 800;
	}

	.pulse-dot {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--color-energy);
	}

	.student-question-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.question-progress-badge,
	.timer-badge {
		display: inline-flex;
		align-items: center;
		border-radius: var(--radius-pill);
		padding: 0.35rem 0.9rem;
		font-size: 0.9rem;
		font-weight: 800;
	}

	.question-progress-badge {
		background: var(--color-brand);
		color: #ffffff;
	}

	.timer-badge {
		border: 1px solid var(--color-border);
		background: var(--color-tint);
	}

	.timer-badge[data-urgent='true'] {
		border-color: #dc2626;
		background: #fef2f2;
		color: #991b1b;
	}

	.student-question-text {
		font-size: clamp(1.3rem, 3vw, 1.85rem);
	}

	.student-question-media {
		display: flex;
		justify-content: center;
		width: 100%;
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-3);
		overflow: hidden;
	}

	.student-question-image {
		max-width: 100%;
		max-height: 16rem;
		border-radius: var(--radius-sm);
		object-fit: contain;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
	}

	.student-options-list {
		display: grid;
		gap: var(--space-3);
	}

	.student-option-button {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: 4rem;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: var(--space-3) var(--space-4);
		color: var(--color-ink);
		font: inherit;
		font-size: 1.05rem;
		font-weight: 800;
		text-align: left;
		cursor: pointer;
		transition:
			transform 80ms ease,
			border-color 120ms ease,
			background-color 120ms ease;
	}

	.student-option-button:hover:not(:disabled) {
		border-color: var(--color-brand);
		background: var(--color-tint);
	}

	.student-option-button[data-selected='true'] {
		border-color: var(--color-brand);
		background: #eef2ff;
		color: var(--color-brand);
	}

	.student-option-button[data-correct='true'] {
		border-color: #1d9a65;
		background: #e3faef;
		color: #0e5a3a;
	}

	.student-option-button:disabled {
		cursor: default;
	}

	.option-letter {
		display: inline-grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		border-radius: 50%;
		background: var(--color-tint);
		color: var(--color-brand);
		font-weight: 900;
		flex-shrink: 0;
	}

	.option-text {
		flex: 1;
	}

	.submission-banner,
	.result-banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
		font-weight: 700;
	}

	.submission-banner {
		border: 1px solid var(--color-brand);
		background: #eef2ff;
		color: var(--color-brand);
	}

	.result-banner {
		border: 1px solid #dc2626;
		background: #fef2f2;
		color: #991b1b;
	}

	.result-banner[data-correct='true'] {
		border-color: #1d9a65;
		background: #e3faef;
		color: #0e5a3a;
	}

	.completion-actions {
		display: flex;
		justify-content: center;
		margin-top: var(--space-2);
	}

	.roster-summary {
		display: grid;
		gap: var(--space-3);
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-4);
		text-align: left;
	}

	.roster-summary h2 {
		font-size: 1rem;
	}

	.roster-pills {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.roster-pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-tint);
		padding: 0.35rem 0.85rem;
		font-size: 0.9rem;
		font-weight: 700;
	}

	.roster-pill[data-self='true'] {
		border-color: var(--color-brand);
		background: #eef2ff;
		color: var(--color-brand);
	}

	.roster-pill[data-status='disconnected'] {
		opacity: 0.6;
	}

	.you-tag {
		font-size: 0.78rem;
		font-weight: 800;
	}

	.student-score-summary {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-3);
		margin-block: var(--space-2);
	}

	.student-score-box {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-3) var(--space-5);
		min-width: 10rem;
	}

	.score-label {
		color: var(--color-muted);
		font-size: 0.8rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.score-val {
		color: var(--color-brand);
		font-size: 1.5rem;
		font-weight: 900;
	}
</style>
