<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import EnergyIcon from '#lib/components/EnergyIcon.svelte';
	import QuestionText from '#lib/components/QuestionText.svelte';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { gsapPop, gsapStagger } from '#lib/shared/animations.js';
	import { BRAND } from '#lib/shared/brand.js';
	import {
		playClockPreview,
		playCountdownTick,
		playTimeUpSound,
		stopCountdownSound,
		unlockAudioContext
	} from '#lib/shared/sound.js';
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
	let soundEnabled = $state(true);
	let lastTickedSecond: number | null = null;

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
			if (status === 'in_progress' && questionPhase === 'open' && currentQuestion && soundEnabled) {
				const deadlineMs = Date.parse(currentQuestion.deadlineAt);
				if (Number.isFinite(deadlineMs)) {
					const secs = Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
					if (secs >= 1 && secs <= 5 && secs !== lastTickedSecond) {
						lastTickedSecond = secs;
						playCountdownTick(secs);
					} else if (secs === 0 && lastTickedSecond !== null && lastTickedSecond > 0) {
						lastTickedSecond = 0;
						playTimeUpSound();
					}
				}
			}
		}, 100);

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
						lastTickedSecond = null;
						nowMs = Date.now();
					} else if (message.type === 'question_ended' && message.payload) {
						const res = message.payload as StudentQuestionResult;
						questionPhase = 'closed';
						if (soundEnabled && lastTickedSecond !== null && lastTickedSecond > 0) {
							lastTickedSecond = 0;
							playTimeUpSound();
						}
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

<svelte:window onpointerdown={unlockAudioContext} onkeydown={unlockAudioContext} />

<svelte:head>
	<title>{data.session.quizTitle} · {BRAND.name}</title>
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
			<div class="play-topbar-actions">
				<button
					type="button"
					class="sound-toggle-pill"
					aria-pressed={soundEnabled}
					onclick={() => {
						unlockAudioContext();
						soundEnabled = !soundEnabled;
						if (soundEnabled) {
							playClockPreview();
						} else {
							stopCountdownSound();
						}
					}}
				>
					{#if soundEnabled}
						<EnergyIcon name="volume-high" /> Sound on
					{:else}
						<EnergyIcon name="volume-x" /> Muted
					{/if}
				</button>
				<span class="connection-pill" data-state={connectionState} role="status">
					{#if connectionState === 'connected'}
						<EnergyIcon name="bolt" /> Connected
					{:else if connectionState === 'connecting'}
						<span class="gruv-spinner" aria-hidden="true"></span> Connecting…
					{:else}
						<span class="gruv-spinner" aria-hidden="true"></span> Reconnecting…
					{/if}
				</span>
			</div>
		</div>

		{#if wsError}
			<p class="form-error" role="alert">{wsError}</p>
		{/if}

		{#if status === 'lobby'}
			<section class="panel waiting-card" aria-labelledby="waiting-title" use:gsapPop>
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
			<section class="panel question-card" aria-labelledby="student-question-title" use:gsapPop>
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
							<EnergyIcon name="timer" /> {remainingSeconds}s
						{:else}
							Time's up
						{/if}
					</span>
				</div>

				<div class="student-question-text">
					<QuestionText id="student-question-title" headingTag="h1" text={currentQuestion.text} />
				</div>

				{#if currentQuestion.imageUrl}
					<div class="student-question-media">
						<img
							src={currentQuestion.imageUrl}
							alt="Question illustration"
							class="student-question-image"
						/>
					</div>
				{/if}

				<div
					class="student-options-list"
					role="group"
					aria-label="Answer options"
					use:gsapStagger={{ selector: '.student-option-button', stagger: 0.06, y: 14 }}
				>
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
					<div class="submission-banner" role="status" use:gsapPop>
						<strong><EnergyIcon name="check" /> Answer locked in!</strong> Waiting for the question to
						finish…
					</div>
				{:else if questionPhase === 'closed' && lastQuestionResult}
					<div
						class="result-banner"
						data-correct={lastQuestionResult.isCorrect}
						role="status"
						use:gsapPop
					>
						{#if lastQuestionResult.isCorrect}
							<strong
								><EnergyIcon name="trophy" /> Correct! +{lastQuestionResult.scoreAwarded} pts</strong
							>
						{:else if lastQuestionResult.selectedOptionId === null}
							<strong><EnergyIcon name="timer" /> Time expired: 0 pts</strong>
						{:else}
							<strong><EnergyIcon name="close" /> Not quite: 0 pts</strong>
						{/if}
						<span>Get ready for the next question…</span>
					</div>
				{/if}
			</section>
		{:else}
			<section class="panel waiting-card" aria-labelledby="completed-title" use:gsapPop>
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
		align-content: center;
		justify-items: center;
		gap: var(--space-4);
		padding-block: var(--space-5) var(--space-6);
	}

	.play-topbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: min(100%, 58rem);
	}

	.play-topbar-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.code-pill,
	.connection-pill,
	.sound-toggle-pill {
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

	.sound-toggle-pill {
		color: var(--color-ink);
		cursor: pointer;
	}

	.sound-toggle-pill:hover {
		background: var(--color-tint);
	}

	.connection-pill[data-state='connected'] {
		border-color: var(--gruv-green);
		background: #2b331b;
		color: var(--gruv-green);
	}

	.connection-pill[data-state='reconnecting'] {
		border-color: var(--gruv-orange);
		background: #3b2618;
		color: var(--gruv-orange);
	}

	.waiting-card,
	.question-card {
		display: grid;
		gap: var(--space-5);
		width: min(100%, 58rem);
		padding: clamp(var(--space-6), 5vw, var(--space-7));
	}

	.waiting-card {
		text-align: center;
	}

	.waiting-quiz-title {
		color: var(--color-muted);
		font-size: 1.15rem;
		font-weight: 400;
	}

	.waiting-pulse {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		border: 2px solid var(--gruv-yellow);
		border-radius: var(--radius-md);
		background: #3b311a;
		color: var(--gruv-yellow);
		padding: var(--space-4);
		font-weight: 400;
	}

	.pulse-dot {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--gruv-orange);
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
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}

	.question-progress-badge {
		background: var(--gruv-orange);
		color: var(--gruv-bg-hard);
	}

	.timer-badge {
		border: 1px solid var(--color-border);
		background: var(--color-tint);
	}

	.timer-badge[data-urgent='true'] {
		border-color: var(--gruv-red);
		background: var(--color-danger-tint);
		color: var(--gruv-red);
	}

	.student-question-text {
		font-size: clamp(1.5rem, 3.2vw, 2.15rem);
		white-space: pre-wrap;
	}

	.student-question-media {
		display: flex;
		justify-content: center;
		width: 100%;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-3);
		overflow: hidden;
	}

	.student-question-image {
		max-width: 100%;
		max-height: 20rem;
		border-radius: var(--radius-sm);
		object-fit: contain;
	}

	.student-options-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
		gap: var(--space-4);
	}

	.student-option-button {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: 4.5rem;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-4) var(--space-5);
		color: var(--color-ink);
		font: inherit;
		font-size: 1.05rem;
		font-weight: 400;
		text-align: left;
		box-shadow: 0 3px 0 var(--gruv-bg-hard);
		cursor: pointer;
		transition:
			transform 100ms ease,
			box-shadow 100ms ease,
			border-color 120ms ease,
			background-color 120ms ease;
	}

	.student-option-button:hover:not(:disabled) {
		border-color: var(--gruv-orange);
		background: var(--gruv-bg2);
		color: var(--gruv-fg0);
		transform: translateY(-2px);
		box-shadow: 0 5px 0 var(--gruv-bg-hard);
	}

	.student-option-button[data-selected='true'] {
		border-color: var(--gruv-orange);
		background: #3b2618;
		color: var(--gruv-fg0);
	}

	.student-option-button[data-correct='true'] {
		border-color: var(--gruv-green);
		background: #2b331b;
		color: var(--gruv-green);
	}

	.student-option-button:disabled {
		cursor: default;
	}

	.option-letter {
		display: inline-grid;
		place-items: center;
		width: 2.1rem;
		height: 2.1rem;
		border-radius: 50%;
		background: var(--gruv-orange);
		color: var(--gruv-bg-hard);
		font-weight: 400;
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
		font-weight: 400;
	}

	.submission-banner {
		border: 2px solid var(--gruv-yellow);
		background: #3b311a;
		color: var(--gruv-yellow);
	}

	.result-banner {
		border: 2px solid var(--gruv-red);
		background: var(--color-danger-tint);
		color: var(--gruv-red);
	}

	.result-banner[data-correct='true'] {
		border-color: var(--gruv-green);
		background: #2b331b;
		color: var(--gruv-green);
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
		font-weight: 400;
	}

	.roster-pill[data-self='true'] {
		border-color: var(--gruv-orange);
		background: #3b2618;
		color: var(--gruv-orange);
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
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.score-val {
		color: var(--color-brand);
		font-size: 1.5rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
</style>
