<script lang="ts">
	import { resolve } from '$app/paths';
	import EnergyIcon from '#lib/components/EnergyIcon.svelte';
	import QuestionText from '#lib/components/QuestionText.svelte';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { gsapStagger } from '#lib/shared/animations.js';
	import { BRAND } from '#lib/shared/brand.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function formatDate(iso: string | null): string {
		if (!iso) return '-';
		const parsed = new Date(iso);
		if (Number.isNaN(parsed.getTime())) return '-';
		return parsed.toLocaleString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Results · {data.results.quizTitle} ({data.results.joinCode}) · {BRAND.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<SiteHeader teacher={data.teacher} />

	<main class="results-main">
		<div class="results-topbar">
			<div class="results-nav">
				<a class="nav-link" href={resolve('/(teacher)/dashboard')}
					><EnergyIcon name="arrow-left" /> Back to dashboard</a
				>
				<a
					class="nav-link"
					href={resolve('/(teacher)/sessions/[sessionId]', {
						sessionId: data.results.sessionId
					})}
				>
					Live session room <EnergyIcon name="arrow-right" />
				</a>
			</div>
			<span class="status-pill" data-status={data.results.status}>
				Status: {data.results.status}
			</span>
		</div>

		<section class="panel summary-hero" aria-labelledby="results-title">
			<div>
				<p class="auth-eyebrow">Teacher-only session report</p>
				<h1 id="results-title">{data.results.quizTitle}</h1>
				<p class="auth-intro">
					Join code <strong>{data.results.joinCode}</strong> · Created
					{formatDate(data.results.createdAt)}
					{#if data.results.endedAt}
						· Completed {formatDate(data.results.endedAt)}
					{/if}
				</p>
			</div>

			<div class="summary-stats">
				<div class="stat-box">
					<span class="stat-label">Players</span>
					<strong class="stat-value">{data.results.participantCount}</strong>
				</div>
				<div class="stat-box">
					<span class="stat-label">Questions</span>
					<strong class="stat-value">{data.results.questionCount}</strong>
				</div>
			</div>
		</section>

		<section class="panel leaderboard-section" aria-labelledby="final-leaderboard-heading">
			<h2 id="final-leaderboard-heading">Leaderboard</h2>

			{#if data.results.leaderboard.length === 0}
				<p class="field-hint">No participants joined this session.</p>
			{:else}
				<div class="table-wrap">
					<table class="results-table">
						<thead>
							<tr>
								<th>Rank</th>
								<th>Player</th>
								<th>Points</th>
								<th>Correct Answers</th>
								<th>Total Time</th>
							</tr>
						</thead>
						<tbody>
							{#each data.results.leaderboard as entry (entry.participantId)}
								<tr>
									<td class="bold-cell">#{entry.rank}</td>
									<td class="bold-cell">{entry.nickname}</td>
									<td class="bold-cell score-cell">{entry.totalScore} pts</td>
									<td>{entry.correctCount} / {data.results.questionCount}</td>
									<td class="time-cell">{(entry.totalResponseTimeMs / 1000).toFixed(1)}s</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="questions-breakdown" aria-labelledby="breakdown-heading">
			<h2 id="breakdown-heading">Question-by-Question Breakdown</h2>

			<div class="question-cards" use:gsapStagger={{ selector: '.question-report-card' }}>
				{#each data.results.questions as question (question.questionId)}
					<article class="panel question-report-card">
						<div class="question-report-header">
							<div>
								<span class="question-badge">Question {question.position + 1}</span>
								<span class="points-badge">
									{question.points} pts · {question.timeLimitSeconds}s
								</span>
							</div>
							<span class="accuracy-pill">
								{question.correctCount} / {question.participantCount} correct ({question.answeredCount}
								answered)
							</span>
						</div>

						<QuestionText headingTag="h3" text={question.text} />

						<ul class="option-stats-list">
							{#each question.optionStats as stat, idx (stat.optionId)}
								<li class="option-stat-row" data-correct={stat.isCorrect}>
									<span class="option-letter">{String.fromCharCode(65 + idx)}</span>
									<span class="option-text">
										{stat.text}
										{#if stat.isCorrect}
											<strong class="correct-label"
												><EnergyIcon name="check" /> Correct answer</strong
											>
										{/if}
									</span>
									<span class="count-pill">{stat.count} chosen</span>
								</li>
							{/each}
						</ul>

						{#if question.participantAnswers.length > 0}
							<details class="player-answers-details">
								<summary
									>Individual student responses ({question.participantAnswers.length})</summary
								>
								<div class="table-wrap">
									<table class="results-table compact-table">
										<thead>
											<tr>
												<th>Student</th>
												<th>Selected Option</th>
												<th>Outcome</th>
												<th>Points</th>
												<th>Time</th>
											</tr>
										</thead>
										<tbody>
											{#each question.participantAnswers as pAns (pAns.participantId)}
												<tr>
													<td class="bold-cell">{pAns.nickname}</td>
													<td>{pAns.selectedOptionText ?? 'No answer'}</td>
													<td>
														{#if pAns.selectedOptionId === null}
															<span class="outcome-tag" data-outcome="missed">No answer</span>
														{:else if pAns.isCorrect}
															<span class="outcome-tag" data-outcome="correct"
																><EnergyIcon name="check" /> Correct</span
															>
														{:else}
															<span class="outcome-tag" data-outcome="wrong"
																><EnergyIcon name="close" /> Incorrect</span
															>
														{/if}
													</td>
													<td>{pAns.scoreAwarded} pts</td>
													<td>
														{pAns.responseTimeMs !== null
															? `${(pAns.responseTimeMs / 1000).toFixed(2)}s`
															: '-'}
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							</details>
						{/if}
					</article>
				{/each}
			</div>
		</section>
	</main>

	<footer class="site-footer">
		<p>{BRAND.name} · {BRAND.tagline}</p>
	</footer>
</div>

<style>
	.results-main {
		display: grid;
		align-content: start;
		gap: var(--space-5);
		padding-block: var(--space-6);
	}

	.results-topbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.results-nav {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
	}

	.status-pill {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		padding: 0.3rem 0.85rem;
		font-size: 0.85rem;
		font-weight: 800;
		text-transform: capitalize;
	}

	.summary-hero {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-5);
		width: 100%;
	}

	.summary-stats {
		display: flex;
		gap: var(--space-3);
	}

	.stat-box {
		display: grid;
		justify-items: center;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-3) var(--space-5);
	}

	.stat-label {
		color: var(--color-muted);
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.stat-value {
		font-family: var(--font-mono);
		font-size: 1.65rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.leaderboard-section,
	.questions-breakdown {
		display: grid;
		gap: var(--space-4);
		width: 100%;
	}

	.question-cards {
		display: grid;
		gap: var(--space-4);
	}

	.question-report-card {
		display: grid;
		gap: var(--space-4);
		width: 100%;
	}

	.question-report-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.question-badge,
	.points-badge,
	.accuracy-pill {
		display: inline-flex;
		align-items: center;
		border-radius: var(--radius-pill);
		padding: 0.25rem 0.8rem;
		font-size: 0.82rem;
		font-weight: 800;
	}

	.question-badge {
		background: var(--gruv-orange);
		color: var(--gruv-bg-hard);
	}

	.points-badge,
	.accuracy-pill {
		border: 1px solid var(--color-border);
		background: var(--color-tint);
	}

	.option-stats-list {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.option-stat-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--gruv-bg1);
		padding: var(--space-3) var(--space-4);
	}

	.option-stat-row[data-correct='true'] {
		border-color: var(--gruv-green);
		background: #2b331b;
	}

	.option-letter {
		display: inline-grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		background: var(--gruv-bg-hard);
		color: var(--gruv-yellow);
		font-weight: 400;
		flex-shrink: 0;
	}

	.option-text {
		flex: 1;
		font-weight: 400;
	}

	.correct-label {
		margin-left: var(--space-2);
		color: var(--gruv-green);
		font-size: 0.85rem;
	}

	.count-pill {
		border-radius: var(--radius-pill);
		background: var(--gruv-bg-hard);
		padding: 0.2rem 0.65rem;
		font-size: 0.82rem;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}

	.player-answers-details summary {
		cursor: pointer;
		font-weight: 400;
		color: var(--gruv-yellow);
	}

	.table-wrap {
		overflow-x: auto;
	}

	.results-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-variant-numeric: tabular-nums;
	}

	.results-table th,
	.results-table td {
		border-bottom: 1px solid var(--color-border);
		padding: var(--space-3) var(--space-4);
	}

	.results-table th {
		color: var(--color-muted);
		font-size: 0.78rem;
		font-weight: 400;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.bold-cell,
	.score-cell,
	.time-cell {
		font-weight: 400;
		color: var(--color-heading);
	}

	.outcome-tag {
		font-weight: 400;
	}

	.outcome-tag[data-outcome='correct'] {
		color: var(--gruv-green);
	}

	.outcome-tag[data-outcome='wrong'] {
		color: var(--gruv-red);
	}

	.outcome-tag[data-outcome='missed'] {
		color: var(--color-muted);
	}
</style>
