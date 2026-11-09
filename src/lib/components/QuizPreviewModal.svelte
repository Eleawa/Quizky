<script lang="ts">
	import EnergyIcon from '#lib/components/EnergyIcon.svelte';
	import { gsapPop } from '#lib/shared/animations.js';
	import type { LibraryQuizDetail } from '#lib/shared/quiz.js';

	interface Props {
		open: boolean;
		quiz: LibraryQuizDetail | null;
		loading: boolean;
		cloning: boolean;
		onClose: () => void;
		onClone: (quizId: string) => void;
	}

	let { open, quiz, loading, cloning, onClose, onClone }: Props = $props();

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="preview-backdrop"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) onClose();
		}}
	>
		<div
			class="preview-dialog panel"
			role="dialog"
			aria-modal="true"
			aria-labelledby="preview-modal-title"
			use:gsapPop
		>
			<div class="preview-header">
				<div>
					<span class="preview-eyebrow">Community Quiz Preview</span>
					<h2 id="preview-modal-title">{quiz?.title ?? 'Loading quiz…'}</h2>
					{#if quiz?.authorName}
						<p class="preview-author">By <strong>{quiz.authorName}</strong></p>
					{/if}
				</div>
				<button
					class="button button-secondary button-small"
					type="button"
					onclick={onClose}
					aria-label="Close preview"
				>
					<EnergyIcon name="close" /> Close
				</button>
			</div>

			<div class="preview-body">
				{#if loading}
					<div class="preview-loading">
						<span class="gruv-spinner" aria-hidden="true"></span>
						<p>Loading questions…</p>
					</div>
				{:else if quiz}
					{#if quiz.description}
						<p class="preview-description">{quiz.description}</p>
					{/if}

					<div class="preview-meta-row">
						<span class="preview-pill">
							<EnergyIcon name="bolt" />
							{quiz.questions.length}
							{quiz.questions.length === 1 ? 'question' : 'questions'}
						</span>
						<span class="preview-pill">
							<EnergyIcon name="timer" />
							{quiz.questions.reduce((sum, q) => sum + q.timeLimitSeconds, 0)}s total time
						</span>
						<span class="preview-pill">
							<EnergyIcon name="trophy" />
							{quiz.questions.reduce((sum, q) => sum + q.points, 0)} total pts
						</span>
					</div>

					<div class="preview-questions-list">
						{#each quiz.questions as question, index (question.id)}
							<article class="preview-question-card">
								<header class="preview-question-header">
									<div class="preview-question-index">
										<span>#{index + 1}</span>
										<strong class="preview-question-title">{question.text}</strong>
									</div>
									<div class="preview-question-stats">
										<span class="mini-pill">{question.timeLimitSeconds}s</span>
										<span class="mini-pill">{question.points} pts</span>
									</div>
								</header>

								{#if question.imageUrl}
									<div class="preview-image-wrap">
										<img
											src={question.imageUrl}
											alt="Question illustration"
											class="preview-image"
											loading="lazy"
										/>
									</div>
								{/if}

								<ul class="preview-options-list">
									{#each question.options as option, optIndex (option.id)}
										<li
											class="preview-option-item"
											class:is-correct={option.isCorrect}
											data-index={optIndex}
										>
											<span class="option-marker" aria-hidden="true">
												{#if option.isCorrect}
													<EnergyIcon name="check" />
												{:else}
													{String.fromCharCode(65 + optIndex)}
												{/if}
											</span>
											<span class="option-text">{option.text}</span>
											{#if option.isCorrect}
												<span class="correct-badge">Correct answer</span>
											{/if}
										</li>
									{/each}
								</ul>
							</article>
						{/each}
					</div>
				{/if}
			</div>

			<div class="preview-footer">
				<button class="button button-secondary" type="button" onclick={onClose}> Close </button>
				{#if quiz}
					<button
						class="button button-primary"
						type="button"
						disabled={cloning}
						onclick={() => onClone(quiz.id)}
					>
						{#if cloning}
							<span class="gruv-spinner" aria-hidden="true"></span>
							Cloning…
						{:else}
							<EnergyIcon name="plus" /> Clone to My Quizzes
						{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.preview-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: grid;
		place-items: center;
		padding: var(--space-4);
		background: rgba(20, 22, 23, 0.78);
		backdrop-filter: blur(4px);
		overflow-y: auto;
	}

	.preview-dialog {
		width: min(48rem, 100%);
		max-height: calc(100vh - 3rem);
		display: grid;
		grid-template-rows: auto 1fr auto;
		background: var(--color-surface);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55);
		overflow: hidden;
	}

	.preview-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		background: var(--gruv-bg-hard);
	}

	.preview-eyebrow {
		display: block;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--gruv-orange);
		font-weight: 700;
	}

	.preview-header h2 {
		margin: 0.2rem 0 0;
		font-size: 1.25rem;
		color: var(--color-heading);
	}

	.preview-author {
		margin: 0.2rem 0 0;
		font-size: 0.82rem;
		color: var(--color-muted);
	}

	.preview-body {
		padding: var(--space-5);
		overflow-y: auto;
		display: grid;
		gap: var(--space-4);
	}

	.preview-description {
		margin: 0;
		font-size: 0.9rem;
		color: var(--color-ink);
		line-height: 1.5;
	}

	.preview-meta-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.preview-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.65rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--color-border);
		background: var(--gruv-bg1);
		font-size: 0.8rem;
		color: var(--color-heading);
	}

	.preview-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-8);
		gap: var(--space-3);
		color: var(--color-muted);
	}

	.preview-questions-list {
		display: grid;
		gap: var(--space-4);
	}

	.preview-question-card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--gruv-bg-hard);
		padding: var(--space-4);
		display: grid;
		gap: var(--space-3);
	}

	.preview-question-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.preview-question-index {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.preview-question-index span {
		color: var(--gruv-orange);
		font-family: var(--font-display);
		font-size: 0.95rem;
	}

	.preview-question-title {
		font-size: 0.95rem;
		color: var(--color-heading);
		line-height: 1.4;
	}

	.preview-question-stats {
		display: flex;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.mini-pill {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 0.15rem 0.45rem;
		font-size: 0.72rem;
		color: var(--color-muted);
		background: var(--gruv-bg0);
	}

	.preview-image-wrap {
		border-radius: var(--radius-sm);
		overflow: hidden;
		max-height: 12rem;
		border: 1px solid var(--color-border);
	}

	.preview-image {
		width: 100%;
		height: 100%;
		max-height: 12rem;
		object-fit: cover;
		display: block;
	}

	.preview-options-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}

	.preview-option-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.75rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--gruv-bg0);
		font-size: 0.85rem;
		color: var(--color-ink);
	}

	.preview-option-item.is-correct {
		border-color: var(--gruv-green);
		background: rgba(184, 187, 38, 0.12);
		color: var(--color-heading);
	}

	.option-marker {
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		background: var(--gruv-bg2);
		font-size: 0.75rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.preview-option-item.is-correct .option-marker {
		background: var(--gruv-green);
		color: var(--gruv-bg-hard);
	}

	.option-text {
		flex: 1;
	}

	.correct-badge {
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--gruv-green);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.preview-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--color-border);
		background: var(--gruv-bg-hard);
	}
</style>
