<script lang="ts">
	import { resolve } from '$app/paths';
	import ThemePicker from '#lib/components/ThemePicker.svelte';
	import { BRAND } from '#lib/shared/brand.js';

	let {
		teacher = null
	}: {
		teacher?: { displayName: string } | null;
	} = $props();
</script>

<header class="site-header d-flex flex-wrap align-items-center justify-content-between gap-2">
	<a class="wordmark" href={resolve('/')} aria-label="{BRAND.name} home">
		<span class="mark" aria-hidden="true">Q</span>
		<span>{BRAND.name}</span>
	</a>

	<nav class="site-nav d-flex flex-wrap align-items-center gap-2" aria-label="Main">
		<ThemePicker />
		{#if teacher}
			<span class="session-name">Hi, {teacher.displayName}</span>
			<a class="button button-secondary" href={resolve('/(teacher)/library')}>Library</a>
			<a class="button button-secondary" href={resolve('/(teacher)/dashboard')}>Dashboard</a>
		{:else}
			<a class="nav-link px-2" href={resolve('/login')}>Sign in</a>
			<a class="button button-primary" href={resolve('/register')}>Create account</a>
		{/if}
	</nav>
</header>

<style>
	.site-header {
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: 0.7rem 1.1rem;
		box-shadow: var(--shadow-card);
	}

	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-heading);
		font-family: var(--font-display);
		font-size: 1.2rem;
		font-weight: 400;
		letter-spacing: 0.01em;
		text-decoration: none;
	}

	.wordmark:hover {
		color: var(--gruv-orange);
	}

	.mark {
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		border: 2px solid var(--gruv-bg-hard);
		border-radius: 0.5rem;
		background: var(--gruv-orange);
		color: var(--gruv-bg-hard);
		font-size: 1.05rem;
		font-weight: 400;
		box-shadow: 0 2px 0 #141617;
	}

	.site-nav {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.session-name {
		max-width: 12rem;
		overflow: hidden;
		color: var(--color-muted);
		font-size: 0.82rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 40rem) {
		.site-header {
			padding: 0.55rem 0.85rem;
		}

		.wordmark {
			font-size: 1.05rem;
		}

		.mark {
			width: 1.95rem;
			height: 1.95rem;
			font-size: 0.95rem;
		}

		.session-name {
			display: none;
		}
	}
</style>
