<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import EnergyIcon from '#lib/components/EnergyIcon.svelte';
	import QrCodeModal from '#lib/components/QrCodeModal.svelte';
	import QuestionText from '#lib/components/QuestionText.svelte';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { BRAND } from '#lib/shared/brand.js';
	import { renderQrCodeSvgData } from '#lib/shared/qrcode.js';
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
		type LeaderboardEntry,
		type PublicParticipant,
		type PublicQuestion,
		type QuestionPhase,
		type RoomSnapshot,
		type TeacherLeaderboard,
		type TeacherQuestionResult
	} from '#lib/shared/session.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function initialSnapshot(): RoomSnapshot {
		return data.snapshot;
	}

	const initial = initialSnapshot();

	let status = $state<GameSessionStatus>(initial.status);
	let questionPhase = $state<QuestionPhase>(initial.questionPhase);
	let currentQuestionIndex = $state<number>(initial.currentQuestionIndex);
	let questionCount = $state<number>(initial.questionCount);
	let participants = $state<PublicParticipant[]>(initial.participants);
	let currentQuestion = $state<PublicQuestion | null>(initial.currentQuestion);
	let answeredCount = $state<number>(initial.answeredCount);
	let lastQuestionResult = $state<TeacherQuestionResult | null>(
		initial.lastQuestionResult?.role === 'teacher' ? initial.lastQuestionResult : null
	);
	let leaderboard = $state<LeaderboardEntry[]>(initial.leaderboard ?? []);
	let nowMs = $state<number>(Date.now());

	let connectionState = $state<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>(
		'connecting'
	);
	let wsError = $state('');
	let copiedCode = $state(false);
	let copiedLink = $state(false);
	let showQrModal = $state(false);
	let soundEnabled = $state(true);
	let lastTickedSecond: number | null = null;
	let activeSocket: WebSocket | null = null;

	let qrSvgData = $derived(renderQrCodeSvgData(data.joinUrl || data.snapshot.joinCode));

	let connectedParticipants = $derived(
		participants.filter((participant) => participant.status === 'connected')
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

	function sendCommand(payload: Record<string, unknown>) {
		if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
			wsError = 'Not connected to the live room. Reconnecting…';
			return;
		}
		wsError = '';
		activeSocket.send(
			JSON.stringify({
				version: PROTOCOL_VERSION,
				...payload
			})
		);
	}

	function handleStartGame() {
		sendCommand({
			type: 'teacher_start_game',
			requestId: crypto.randomUUID()
		});
	}

	function handleAdvanceQuestion() {
		sendCommand({
			type: 'teacher_advance_question',
			requestId: crypto.randomUUID()
		});
	}

	function handleSkipQuestion() {
		sendCommand({
			type: 'teacher_skip_question',
			requestId: crypto.randomUUID()
		});
	}

	function handleEndGame() {
		const promptText =
			status === 'lobby'
				? 'Cancel this lobby? Students will not be able to join.'
				: 'End the live game now and finalize the current scores?';
		if (!window.confirm(promptText)) return;
		sendCommand({
			type: 'teacher_end_game',
			requestId: crypto.randomUUID()
		});
	}

	async function copyText(text: string, kind: 'code' | 'link') {
		try {
			await navigator.clipboard.writeText(text);
			if (kind === 'code') {
				copiedCode = true;
				setTimeout(() => (copiedCode = false), 2000);
			} else {
				copiedLink = true;
				setTimeout(() => (copiedLink = false), 2000);
			}
		} catch {
			// Clipboard API unavailable.
		}
	}

	onMount(() => {
		if (window.location.search.includes('qr=1')) {
			showQrModal = true;
		}

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

			const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			const wsUrl = `${wsProtocol}//${window.location.host}/api/sessions/${encodeURIComponent(data.snapshot.sessionId)}/ws?role=teacher`;

			socket = new WebSocket(wsUrl);
			activeSocket = socket;

			socket.addEventListener('open', () => {
				attempt = 0;
				connectionState = 'connected';
				wsError = '';
				socket?.send(
					JSON.stringify({
						version: PROTOCOL_VERSION,
						type: 'join_session'
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
						currentQuestionIndex = snap.currentQuestionIndex;
						questionCount = snap.questionCount;
						participants = snap.participants;
						currentQuestion = snap.currentQuestion;
						answeredCount = snap.answeredCount;
						if (snap.lastQuestionResult?.role === 'teacher') {
							lastQuestionResult = snap.lastQuestionResult;
						}
						if (snap.leaderboard) {
							leaderboard = snap.leaderboard;
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
						currentQuestionIndex = q.position;
						currentQuestion = q;
						answeredCount = 0;
						lastQuestionResult = null;
						lastTickedSecond = null;
						nowMs = Date.now();
					} else if (message.type === 'answer_received' && message.payload) {
						const payload = message.payload as { answeredCount: number };
						answeredCount = payload.answeredCount;
					} else if (message.type === 'question_ended' && message.payload) {
						const res = message.payload as TeacherQuestionResult;
						questionPhase = 'closed';
						if (soundEnabled && lastTickedSecond !== null && lastTickedSecond > 0) {
							lastTickedSecond = 0;
							playTimeUpSound();
						}
						if (res.role === 'teacher') {
							lastQuestionResult = res;
							answeredCount = res.answeredCount;
						}
					} else if (message.type === 'leaderboard_updated' && message.payload) {
						const lb = message.payload as TeacherLeaderboard;
						leaderboard = lb.entries;
					} else if (message.type === 'game_completed' && message.payload) {
						const summary = message.payload as GameSummary;
						status = summary.status ?? 'completed';
						questionPhase = 'closed';
						if (summary.leaderboard) {
							leaderboard = summary.leaderboard;
						}
					} else if (message.type === 'error' && message.payload) {
						const err = message.payload as { message?: string };
						wsError = err.message ?? 'Session error.';
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
				wsError = 'Live connection interrupted. Reconnecting…';
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
	<title>Session {data.snapshot.joinCode} · {data.snapshot.quizTitle} · {BRAND.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<SiteHeader teacher={data.teacher} />

	<main class="lobby-main">
		<div class="lobby-topbar">
			<a class="nav-link" href={resolve('/(teacher)/dashboard')}
				><EnergyIcon name="arrow-left" /> Back to dashboard</a
			>
			<div class="topbar-badges">
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
				<span class="status-pill" data-status={status}>Status: {status}</span>
				<div class="connection-pill" data-state={connectionState} role="status">
					{#if connectionState === 'connected'}
						<EnergyIcon name="bolt" /> Live connection active
					{:else if connectionState === 'connecting'}
						<span class="gruv-spinner" aria-hidden="true"></span> Connecting…
					{:else}
						<span class="gruv-spinner" aria-hidden="true"></span> Reconnecting…
					{/if}
				</div>
			</div>
		</div>

		{#if wsError}
			<p class="form-error" role="alert">{wsError}</p>
		{/if}

		<section class="panel join-banner" aria-labelledby="lobby-quiz-title">
			<div class="join-banner-info">
				<p class="auth-eyebrow">
					{status === 'lobby'
						? 'Live session lobby'
						: status === 'in_progress'
							? 'Live session in progress'
							: 'Session ended'}
				</p>
				<h1 id="lobby-quiz-title">{data.snapshot.quizTitle}</h1>
				<p class="auth-intro">
					{questionCount}
					{questionCount === 1 ? 'question' : 'questions'} · {participants.length}
					{participants.length === 1 ? 'player' : 'players'} joined
				</p>

				{#if status === 'lobby' || status === 'in_progress'}
					<div class="share-link-box">
						<span class="share-link-label">Join link:</span>
						<code class="share-link-url">{data.joinUrl}</code>
						<button
							class="button button-secondary button-small"
							type="button"
							onclick={() => copyText(data.joinUrl, 'link')}
						>
							{#if copiedLink}
								<EnergyIcon name="check" /> Copied link
							{:else}
								<EnergyIcon name="link" /> Copy link
							{/if}
						</button>
						<button
							class="button button-primary button-small"
							type="button"
							onclick={() => (showQrModal = true)}
						>
							<EnergyIcon name="qr-code" />
							Share QR code
						</button>
					</div>
				{/if}
			</div>

			<div class="join-banner-cards">
				{#if status === 'lobby' || status === 'in_progress'}
					<div class="join-qr-card">
						<span class="join-code-label">Scan to join</span>
						<button
							class="qr-preview-button"
							type="button"
							onclick={() => (showQrModal = true)}
							title="Click to enlarge QR code"
							aria-label="Enlarge QR code for {data.joinUrl}"
						>
							<svg
								viewBox="0 0 {qrSvgData.viewBoxSize} {qrSvgData.viewBoxSize}"
								shape-rendering="crispEdges"
								class="qr-inline-svg"
								role="img"
								aria-label="Session QR code"
							>
								<rect width={qrSvgData.viewBoxSize} height={qrSvgData.viewBoxSize} fill="#fbf1c7" />
								<path d={qrSvgData.pathData} fill="#1d2021" />
							</svg>
						</button>
						<button
							class="button button-secondary button-small"
							type="button"
							onclick={() => (showQrModal = true)}
						>
							Enlarge QR
						</button>
					</div>
				{/if}

				<div class="join-code-card">
					<span class="join-code-label">Join code</span>
					<strong class="join-code-value" aria-label="Join code {data.snapshot.joinCode}">
						{data.snapshot.joinCode}
					</strong>
					<button
						class="button button-secondary button-small"
						type="button"
						onclick={() => copyText(data.snapshot.joinCode, 'code')}
					>
						{#if copiedCode}
							<EnergyIcon name="check" /> Copied code
						{:else}
							<EnergyIcon name="copy" /> Copy code
						{/if}
					</button>
				</div>
			</div>
		</section>

		{#if status === 'in_progress' && currentQuestion}
			<section class="panel live-question-panel" aria-labelledby="active-question-title">
				<div class="question-header-bar">
					<div>
						<span class="question-progress-badge">
							Question {currentQuestion.position + 1} of {currentQuestion.totalQuestions}
						</span>
						<span class="question-points-badge">{currentQuestion.points} pts</span>
					</div>

					<div class="question-metrics">
						<div class="metric-pill">
							<span>Answers</span>
							<strong>{answeredCount} / {participants.length}</strong>
						</div>
						<div
							class="metric-pill timer-pill"
							data-phase={questionPhase}
							data-urgent={questionPhase === 'open' && remainingSeconds <= 5}
						>
							{#if questionPhase === 'open'}
								<span>Time left</span>
								<strong>{remainingSeconds}s</strong>
							{:else}
								<span>Phase</span>
								<strong>Closed</strong>
							{/if}
						</div>
						{#if questionPhase === 'open'}
							<button
								type="button"
								class="button button-small button-secondary skip-quick-btn"
								onclick={handleSkipQuestion}
								title="Skip question"
							>
								<EnergyIcon name="skip-forward" size="0.9em" />
								<span>Skip</span>
							</button>
						{/if}
					</div>
				</div>

				<div class="active-question-text">
					<QuestionText id="active-question-title" headingTag="h2" text={currentQuestion.text} />
				</div>

				{#if currentQuestion.imageUrl}
					<div class="active-question-media">
						<img
							src={currentQuestion.imageUrl}
							alt="Question illustration"
							class="active-question-image"
						/>
					</div>
				{/if}

				{#if questionPhase === 'open'}
					<ul class="teacher-options-grid">
						{#each currentQuestion.options as option, idx (option.id)}
							<li class="teacher-option-card">
								<span class="option-letter">{String.fromCharCode(65 + idx)}</span>
								<span class="option-label">{option.text}</span>
							</li>
						{/each}
					</ul>
				{:else if lastQuestionResult}
					<div class="question-results-box">
						<h3>Question results ({lastQuestionResult.answeredCount} answered)</h3>
						<ul class="teacher-options-grid">
							{#each lastQuestionResult.optionStats as stat, idx (stat.optionId)}
								<li class="teacher-option-card" data-correct={stat.isCorrect}>
									<span class="option-letter">{String.fromCharCode(65 + idx)}</span>
									<span class="option-label">
										{stat.text}
										{#if stat.isCorrect}
											<strong class="correct-tag"><EnergyIcon name="check" /> Correct</strong>
										{/if}
									</span>
									<span class="option-count-badge">{stat.count}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<div class="teacher-game-controls">
					{#if questionPhase === 'open'}
						<button class="button button-primary" type="button" onclick={handleAdvanceQuestion}>
							Close question & show results
						</button>
					{:else if currentQuestionIndex < questionCount - 1}
						<button class="button button-primary" type="button" onclick={handleAdvanceQuestion}>
							Next question <EnergyIcon name="arrow-right" />
						</button>
					{/if}

					<button class="button button-secondary" type="button" onclick={handleEndGame}>
						End game
					</button>
				</div>
			</section>
		{/if}

		{#if status === 'in_progress' || status === 'completed'}
			<section class="panel leaderboard-panel" aria-labelledby="leaderboard-heading">
				<div class="participants-header">
					<div>
						<p class="auth-eyebrow">Teacher-only view</p>
						<h2 id="leaderboard-heading">
							{status === 'completed' ? 'Final Leaderboard' : 'Live Leaderboard'}
						</h2>
					</div>
					<a
						class="button button-secondary button-small"
						href={resolve('/(teacher)/sessions/[sessionId]/results', {
							sessionId: data.snapshot.sessionId
						})}
					>
						Full question breakdown <EnergyIcon name="arrow-right" />
					</a>
				</div>

				{#if leaderboard.length === 0}
					<p class="field-hint">No participants scored in this session.</p>
				{:else}
					<div class="table-wrap">
						<table class="leaderboard-table">
							<thead>
								<tr>
									<th>Rank</th>
									<th>Player</th>
									<th>Points</th>
									<th>Correct</th>
									<th>Total Time</th>
								</tr>
							</thead>
							<tbody>
								{#each leaderboard as entry (entry.participantId)}
									<tr>
										<td class="rank-cell">#{entry.rank}</td>
										<td class="name-cell">{entry.nickname}</td>
										<td class="score-cell">{entry.totalScore} pts</td>
										<td>{entry.correctCount} / {questionCount}</td>
										<td class="time-cell">{(entry.totalResponseTimeMs / 1000).toFixed(1)}s</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
		{/if}

		<section class="panel participants-panel" aria-labelledby="participants-heading">
			<div class="participants-header">
				<div>
					<h2 id="participants-heading">
						Players ({connectedParticipants.length} connected / {participants.length} total)
					</h2>
					<p class="field-hint">
						Players appear here automatically as soon as they join with their nickname.
					</p>
				</div>

				{#if status === 'lobby'}
					<div class="lobby-controls">
						<button class="button button-secondary" type="button" onclick={handleEndGame}>
							Cancel lobby
						</button>
						<button
							class="button button-primary"
							type="button"
							disabled={participants.length === 0}
							onclick={handleStartGame}
						>
							Start game ({participants.length})
						</button>
					</div>
				{/if}
			</div>

			{#if participants.length === 0}
				<div class="empty-lobby" role="status">
					<p class="empty-lobby-title">Waiting for students to join…</p>
					<p class="field-hint">
						Ask students to open <strong>{data.joinUrl}</strong> or enter code
						<strong>{data.snapshot.joinCode}</strong> on the Quizky home page.
					</p>
				</div>
			{:else}
				<ul class="participant-grid" aria-live="polite">
					{#each participants as participant (participant.id)}
						<li class="participant-chip" data-status={participant.status}>
							<span class="participant-name">{participant.nickname}</span>
							<span class="participant-state">
								{#if participant.status === 'connected'}
									<EnergyIcon name="bolt" /> Connected
								{:else if participant.status === 'finished'}
									<EnergyIcon name="check" /> Finished
								{:else}
									<EnergyIcon name="close" /> Disconnected
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</main>

	<QrCodeModal
		open={showQrModal}
		quizTitle={data.snapshot.quizTitle}
		joinCode={data.snapshot.joinCode}
		joinUrl={data.joinUrl}
		onClose={() => (showQrModal = false)}
	/>

	<footer class="site-footer">
		<p>{BRAND.name} · {BRAND.tagline}</p>
	</footer>
</div>

<style>
	.lobby-main {
		display: grid;
		align-content: start;
		gap: var(--space-5);
		padding-block: var(--space-6);
	}

	.lobby-topbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.topbar-badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.status-pill,
	.connection-pill,
	.sound-toggle-pill {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		padding: 0.3rem 0.85rem;
		font-size: 0.82rem;
		font-weight: 700;
		text-transform: capitalize;
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

	.join-banner {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: var(--space-5);
		width: 100%;
	}

	.share-link-box {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-3);
	}

	.share-link-label {
		font-size: 0.85rem;
		font-weight: 800;
	}

	.share-link-url {
		font-size: 0.9rem;
		word-break: break-all;
	}

	.join-banner-cards {
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		justify-content: flex-end;
		gap: var(--space-3);
	}

	.join-qr-card,
	.join-code-card {
		display: grid;
		justify-items: center;
		align-content: space-between;
		gap: var(--space-2);
		border: 2px solid var(--color-brand);
		border-radius: var(--radius-lg);
		background: var(--color-tint);
		padding: var(--space-4) var(--space-5);
		text-align: center;
	}

	.qr-preview-button {
		display: grid;
		place-items: center;
		width: 6.75rem;
		height: 6.75rem;
		border: 2px solid var(--gruv-fg0);
		border-radius: var(--radius-md);
		background: #fbf1c7;
		padding: 0.25rem;
		cursor: pointer;
		transition: border-color 120ms ease;
	}

	.qr-preview-button:hover {
		border-color: var(--color-brand);
	}

	.qr-inline-svg {
		width: 100%;
		height: 100%;
		display: block;
	}

	.join-code-label {
		color: var(--color-brand);
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.join-code-value {
		color: var(--color-ink);
		font-family: var(--font-mono);
		font-size: clamp(2rem, 5vw, 3.1rem);
		font-weight: 700;
		letter-spacing: 0.14em;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}

	.live-question-panel,
	.leaderboard-panel,
	.participants-panel {
		display: grid;
		gap: var(--space-5);
		width: 100%;
	}

	.question-header-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.question-progress-badge,
	.question-points-badge {
		display: inline-flex;
		align-items: center;
		border-radius: var(--radius-pill);
		padding: 0.3rem 0.85rem;
		font-size: 0.85rem;
		font-weight: 800;
	}

	.question-progress-badge {
		background: var(--gruv-orange);
		color: var(--gruv-bg-hard);
	}

	.question-points-badge {
		margin-left: var(--space-2);
		border: 1px solid var(--color-border);
		background: var(--color-tint);
	}

	.question-metrics {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.metric-pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: 0.45rem 0.9rem;
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}

	.timer-pill[data-urgent='true'] {
		border-color: var(--gruv-red);
		background: var(--color-danger-tint);
		color: var(--gruv-red);
	}

	.active-question-text {
		font-size: clamp(1.3rem, 2.8vw, 1.85rem);
		white-space: pre-wrap;
	}

	.active-question-media {
		display: flex;
		justify-content: center;
		width: 100%;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-3);
		overflow: hidden;
	}

	.active-question-image {
		max-width: 100%;
		max-height: 20rem;
		border-radius: var(--radius-sm);
		object-fit: contain;
	}

	.teacher-options-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.teacher-option-card {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-3) var(--space-4);
		font-weight: 600;
	}

	.teacher-option-card[data-correct='true'] {
		border-color: var(--gruv-green);
		background: #2b331b;
	}

	.option-letter {
		display: inline-grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: var(--gruv-orange);
		color: var(--gruv-bg-hard);
		font-weight: 400;
		flex-shrink: 0;
	}

	.option-label {
		flex: 1;
	}

	.correct-tag {
		margin-left: var(--space-2);
		color: var(--gruv-green);
		font-size: 0.85rem;
	}

	.option-count-badge {
		border-radius: var(--radius-pill);
		background: var(--color-tint);
		padding: 0.2rem 0.65rem;
		font-size: 0.85rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.teacher-game-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-4);
	}

	.table-wrap {
		overflow-x: auto;
	}

	.leaderboard-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-variant-numeric: tabular-nums;
	}

	.leaderboard-table th,
	.leaderboard-table td {
		border-bottom: 1px solid var(--color-border);
		padding: var(--space-3) var(--space-4);
	}

	.leaderboard-table th {
		color: var(--color-muted);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.rank-cell,
	.score-cell,
	.name-cell,
	.time-cell {
		font-weight: 700;
	}

	.participants-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.lobby-controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.empty-lobby {
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-6);
		text-align: center;
	}

	.empty-lobby-title {
		margin-bottom: var(--space-2);
		font-size: 1.1rem;
		font-weight: 700;
	}

	.participant-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.participant-chip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-3) var(--space-4);
	}

	.participant-chip[data-status='connected'] {
		border-color: var(--gruv-green);
		background: #2b331b;
	}

	.participant-chip[data-status='disconnected'] {
		opacity: 0.7;
	}

	.participant-name {
		font-weight: 700;
	}

	.participant-state {
		color: var(--color-muted);
		font-size: 0.78rem;
		font-weight: 600;
	}

	@media (max-width: 52rem) {
		.join-banner {
			grid-template-columns: 1fr;
		}

		.join-banner-cards {
			justify-content: flex-start;
		}
	}
</style>
