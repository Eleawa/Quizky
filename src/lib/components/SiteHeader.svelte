<script lang="ts">
	import { resolve } from '$app/paths';
	import { BRAND } from '#lib/shared/brand.js';

	let {
		teacher = null
	}: {
		teacher?: { displayName: string } | null;
	} = $props();
</script>

<header class="site-header">
	<a class="wordmark" href={resolve('/')} aria-label="{BRAND.name} home">
		<span class="mark" aria-hidden="true">Q</span>
		{BRAND.name}
	</a>

	<nav class="site-nav" aria-label="Main">
		{#if teacher}
			<span class="session-name">Hi, {teacher.displayName}</span>
			<a class="button button-secondary" href={resolve('/(teacher)/dashboard')}>Dashboard</a>
		{:else}
			<a class="nav-link" href={resolve('/login')}>Sign in</a>
			<a class="button button-primary" href={resolve('/register')}>Create account</a>
		{/if}
	</nav>
</header>

<style>
	.site-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-ink);
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		text-decoration: none;
	}

	.mark {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.7rem;
		background: var(--color-brand);
		color: var(--color-surface);
		font-size: 1.2rem;
	}

	.site-nav {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.session-name {
		max-width: 12rem;
		overflow: hidden;
		color: var(--color-muted);
		font-size: 0.85rem;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 40rem) {
		.wordmark {
			font-size: 1.15rem;
		}

		.site-nav {
			gap: var(--space-2);
		}

		.session-name {
			display: none;
		}
	}
</style>
