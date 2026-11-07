<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { BRAND } from '#lib/shared/brand.js';
	import { JOIN_CODE_LENGTH } from '#lib/shared/session.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let joinCode = $state('');
	let codeError = $state('');

	async function handleJoinCodeSubmit(event: SubmitEvent) {
		event.preventDefault();
		const clean = joinCode.trim().toUpperCase();
		if (clean.length !== JOIN_CODE_LENGTH) {
			codeError = 'Enter a 6-character join code.';
			return;
		}
		codeError = '';
		await goto(resolve('/join/[code]', { code: clean }));
	}
</script>

<svelte:head>
	<title>{BRAND.name} — {BRAND.tagline}</title>
	<meta
		name="description"
		content="Quizky is a live, teacher-led quiz platform. Students join with a code and nickname, no account required."
	/>
</svelte:head>

<div class="page">
	<SiteHeader teacher={data.teacher} />

	<main>
		<section class="hero" aria-labelledby="hero-title">
			<p class="eyebrow">Live, teacher-led quizzes</p>
			<h1 id="hero-title">
				<span class="play">Play.</span>
				<span class="think">Think.</span>
				<span class="win">Win.</span>
			</h1>
			<p class="lede">
				Quizky turns your questions into a fast, friendly game show. Teachers host from any screen;
				students join with a code and a nickname.
			</p>

			<form class="join-box" onsubmit={handleJoinCodeSubmit} novalidate>
				<label class="join-box-label" for="home-join-code">Have a game code?</label>
				<div class="join-box-row">
					<input
						id="home-join-code"
						type="text"
						class="join-box-input"
						maxlength={JOIN_CODE_LENGTH}
						placeholder="6-CHAR CODE"
						autocapitalize="characters"
						autocomplete="off"
						spellcheck="false"
						bind:value={joinCode}
						aria-invalid={codeError ? 'true' : undefined}
					/>
					<button class="button button-primary" type="submit">Join game</button>
				</div>
				{#if codeError}
					<p class="field-error" role="alert">{codeError}</p>
				{/if}
			</form>

			<div class="cta-row">
				{#if data.teacher}
					<a class="button button-primary" href={resolve('/(teacher)/dashboard')}
						>Open your dashboard</a
					>
				{:else}
					<a class="button button-primary" href={resolve('/register')}>Create a teacher account</a>
					<a class="button button-secondary" href={resolve('/login')}>Sign in</a>
				{/if}
			</div>
		</section>

		<section class="features" aria-label="What Quizky will do">
			<article class="feature">
				<span class="feature-dot dot-blue" aria-hidden="true"></span>
				<h2>Host a live game</h2>
				<p>Create a quiz, open a lobby, and share a short join code with your class.</p>
			</article>
			<article class="feature">
				<span class="feature-dot dot-orange" aria-hidden="true"></span>
				<h2>Join in seconds</h2>
				<p>Students enter a nickname and answer on any phone, tablet, or laptop.</p>
			</article>
			<article class="feature">
				<span class="feature-dot dot-green" aria-hidden="true"></span>
				<h2>See who got it</h2>
				<p>The server keeps score and timing fair, with results saved for the teacher.</p>
			</article>
		</section>
	</main>

	<footer class="site-footer">
		<p>{BRAND.name} · {BRAND.tagline}</p>
	</footer>
</div>

<style>
	main {
		display: grid;
		align-content: center;
		gap: var(--space-7);
		padding-block: var(--space-7);
	}

	.hero {
		max-width: 44rem;
	}

	.eyebrow {
		margin-bottom: var(--space-3);
		color: var(--color-brand);
		font-size: 0.85rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		font-size: clamp(3rem, 10vw, 6.5rem);
		font-weight: 900;
	}

	.play {
		color: var(--color-brand);
	}

	.think {
		color: var(--color-energy);
	}

	.win {
		color: var(--color-success);
	}

	.lede {
		max-width: 36rem;
		margin-top: var(--space-5);
		color: var(--color-muted);
		font-size: clamp(1.05rem, 2vw, 1.25rem);
	}

	.cta-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-5);
	}

	.join-box {
		display: grid;
		gap: var(--space-2);
		max-width: 28rem;
		margin-top: var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: var(--space-4);
		box-shadow: var(--shadow-card);
	}

	.join-box-label {
		font-size: 0.88rem;
		font-weight: 800;
	}

	.join-box-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.join-box-input {
		flex: 1;
		min-width: 10rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: #fbfcff;
		padding: 0.65rem 1rem;
		color: var(--color-ink);
		font: inherit;
		font-weight: 900;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.features {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: var(--space-4);
	}

	.feature {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: var(--space-5);
		box-shadow: var(--shadow-card);
	}

	.feature h2 {
		margin-top: var(--space-3);
		font-size: 1.15rem;
	}

	.feature p {
		margin-top: var(--space-2);
		color: var(--color-muted);
		font-size: 0.92rem;
	}

	.feature-dot {
		display: block;
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
	}

	.dot-blue {
		background: var(--color-brand);
	}

	.dot-orange {
		background: var(--color-energy);
	}

	.dot-green {
		background: var(--color-success);
	}

	@media (max-width: 40rem) {
		h1 {
			font-size: clamp(2.6rem, 16vw, 4rem);
		}
	}
</style>
