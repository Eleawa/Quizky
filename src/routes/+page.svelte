<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import EnergyIcon from '#lib/components/EnergyIcon.svelte';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { gsapReveal, gsapStagger } from '#lib/shared/animations.js';
	import { BRAND } from '#lib/shared/brand.js';
	import { JOIN_CODE_LENGTH } from '#lib/shared/session.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let joinCode = $state('');
	let codeError = $state('');
	let joining = $state(false);

	async function handleJoinCodeSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (joining) return;
		const clean = joinCode.trim().toUpperCase();
		if (clean.length !== JOIN_CODE_LENGTH) {
			codeError = 'Enter a 6-character join code.';
			return;
		}
		codeError = '';
		joining = true;
		try {
			await goto(resolve('/join/[code]', { code: clean }));
		} finally {
			joining = false;
		}
	}
</script>

<svelte:head>
	<title>{BRAND.name} · {BRAND.tagline}</title>
	<meta
		name="description"
		content="Quizky is a live, teacher-led quiz platform. Students join with a code and nickname, no account required."
	/>
</svelte:head>

<div class="page">
	<SiteHeader teacher={data.teacher} />

	<main>
		<section class="hero row g-4 align-items-center" aria-labelledby="hero-title">
			<div class="hero-copy col-12 col-lg-7" use:gsapReveal={{ y: 20 }}>
				<p class="eyebrow">Live, teacher-led quizzes</p>
				<h1 id="hero-title">
					<span class="play">Play.</span>
					<span class="think">Think.</span>
					<span class="win">Win.</span>
				</h1>
				<p class="lede">
					Quizky turns your questions into a fast, friendly game show. Teachers host from any
					screen; students join with a code and a nickname.
				</p>

				<div class="cta-row">
					{#if data.teacher}
						<a class="button button-primary" href={resolve('/(teacher)/dashboard')}
							>Open your dashboard</a
						>
					{:else}
						<a class="button button-primary" href={resolve('/register')}>Create a teacher account</a
						>
						<a class="button button-secondary" href={resolve('/login')}>Sign in</a>
					{/if}
				</div>
			</div>

			<div class="col-12 col-lg-5" use:gsapReveal={{ y: 20, delay: 0.08 }}>
				<form class="join-box" onsubmit={handleJoinCodeSubmit} novalidate>
					<label class="join-box-label" for="home-join-code">Have a game code?</label>
					<p class="join-box-hint">Enter the 6-character code shown on your teacher's screen.</p>
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
						<button class="button button-primary" type="submit" disabled={joining}>
							{#if joining}
								<span class="gruv-spinner" aria-hidden="true"></span>
							{/if}
							Join game
						</button>
					</div>
					{#if codeError}
						<p class="field-error" role="alert">{codeError}</p>
					{/if}
				</form>
			</div>
		</section>

		<section
			class="features row g-3"
			aria-label="What Quizky will do"
			use:gsapStagger={{ selector: '.feature', delay: 0.14 }}
		>
			<div class="col-12 col-md-4 d-flex">
				<article class="feature w-100">
					<span class="feature-icon-badge" aria-hidden="true">
						<EnergyIcon name="bolt" size="1.4em" />
					</span>
					<h2>Host a live game</h2>
					<p>Create a quiz, open a lobby, and share a short join code with your class.</p>
				</article>
			</div>
			<div class="col-12 col-md-4 d-flex">
				<article class="feature w-100">
					<span class="feature-icon-badge badge-yellow" aria-hidden="true">
						<EnergyIcon name="timer" size="1.4em" />
					</span>
					<h2>Join in seconds</h2>
					<p>Students enter a nickname and answer on any phone, tablet, or laptop.</p>
				</article>
			</div>
			<div class="col-12 col-md-4 d-flex">
				<article class="feature w-100">
					<span class="feature-icon-badge badge-green" aria-hidden="true">
						<EnergyIcon name="trophy" size="1.4em" />
					</span>
					<h2>See who got it</h2>
					<p>The server keeps score and timing fair, with results saved for the teacher.</p>
				</article>
			</div>
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
		gap: var(--space-6);
		padding-block: var(--space-6);
	}

	.hero-copy {
		display: grid;
		gap: var(--space-3);
	}

	.eyebrow {
		color: var(--gruv-orange);
		font-size: 0.78rem;
		font-weight: 400;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	h1 {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
		font-size: clamp(2.1rem, 5.2vw, 3.6rem);
		font-weight: 400;
		line-height: 1.15;
	}

	.play {
		color: var(--gruv-orange);
	}

	.think {
		color: var(--gruv-yellow);
	}

	.win {
		color: var(--gruv-green);
	}

	.lede {
		max-width: 34rem;
		color: var(--color-muted);
		font-size: clamp(0.95rem, 1.4vw, 1.08rem);
	}

	.cta-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}

	.join-box {
		display: grid;
		gap: var(--space-3);
		width: 100%;
		border: 2px solid var(--gruv-orange);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		padding: var(--space-5);
		box-shadow: var(--shadow-card);
	}

	.join-box-label {
		color: var(--color-heading);
		font-size: 1rem;
		font-weight: 400;
	}

	.join-box-hint {
		color: var(--color-muted);
		font-size: 0.84rem;
	}

	.join-box-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.join-box-input {
		flex: 1;
		min-width: 9rem;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--gruv-bg-hard);
		padding: 0.65rem 0.9rem;
		color: var(--gruv-yellow);
		font-family: var(--font-mono);
		font-size: 1.05rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		font-variant-numeric: tabular-nums;
	}

	.join-box-input::placeholder {
		color: var(--gruv-gray);
	}

	.join-box-input:focus {
		border-color: var(--gruv-orange);
		outline: none;
	}

	.feature {
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: var(--space-5);
		box-shadow: var(--shadow-card);
		transition:
			transform 150ms ease,
			border-color 150ms ease;
	}

	.feature:hover {
		transform: translateY(-2px);
		border-color: var(--gruv-bg3);
	}

	.feature h2 {
		margin-top: var(--space-3);
		font-size: 1.05rem;
	}

	.feature p {
		margin-top: var(--space-2);
		color: var(--color-muted);
		font-size: 0.88rem;
	}

	.feature-icon-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		border: 2px solid var(--gruv-orange);
		border-radius: var(--radius-sm);
		background: rgba(254, 128, 25, 0.12);
		color: var(--gruv-orange);
		box-shadow: 0 2px 0 #141617;
	}

	.feature-icon-badge.badge-yellow {
		border-color: var(--gruv-yellow);
		background: rgba(250, 189, 47, 0.12);
		color: var(--gruv-yellow);
	}

	.feature-icon-badge.badge-green {
		border-color: var(--gruv-green);
		background: rgba(184, 187, 38, 0.12);
		color: var(--gruv-green);
	}
</style>
