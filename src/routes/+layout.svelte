<script lang="ts">
	import 'bootstrap/dist/css/bootstrap.min.css';
	import 'energy-icons/font/style.css';
	import './../styles/tokens.css';
	import './../styles/app.css';
	import './../styles/themes.css';
	import { gsap } from 'gsap';
	import { onMount, tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { navigating } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import { animateRouteEnter } from '#lib/shared/animations.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	let appShell: HTMLElement | null = $state(null);
	let progressBar: HTMLElement | null = $state(null);
	let isNavigating = $derived(Boolean(navigating.to));

	$effect(() => {
		if (!progressBar) return;
		if (isNavigating) {
			gsap.killTweensOf(progressBar);
			gsap.set(progressBar, { autoAlpha: 1, scaleX: 0.08, transformOrigin: 'left center' });
			gsap.to(progressBar, {
				scaleX: 0.85,
				duration: 1.4,
				ease: 'power2.out'
			});
		} else {
			gsap.to(progressBar, {
				scaleX: 1,
				duration: 0.2,
				ease: 'power2.out',
				onComplete: () => {
					if (progressBar) {
						gsap.to(progressBar, { autoAlpha: 0, duration: 0.22 });
					}
				}
			});
		}
	});

	onMount(() => {
		import('bootstrap/dist/js/bootstrap.bundle.min.js').catch(() => {
			// Ignore in environments without window/document
		});
	});

	afterNavigate(async () => {
		await tick();
		animateRouteEnter(appShell);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#1d2021" />
</svelte:head>

<div class="route-loader-track" aria-hidden="true">
	<div class="route-loader-bar" bind:this={progressBar}></div>
</div>

{#if isNavigating}
	<div class="route-loader-pill" role="status" aria-live="polite">
		<span class="gruv-spinner" aria-hidden="true"></span>
		<span>Loading…</span>
	</div>
{/if}

<div class="app-shell" bind:this={appShell}>
	{@render children()}
</div>

<style>
	.app-shell {
		display: contents;
	}

	.route-loader-track {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 9999;
		height: 4px;
		pointer-events: none;
	}

	.route-loader-bar {
		width: 100%;
		height: 100%;
		background: var(--gruv-orange);
		opacity: 0;
		transform: scaleX(0);
		transform-origin: left center;
	}

	.route-loader-pill {
		position: fixed;
		bottom: 1.1rem;
		right: 1.1rem;
		z-index: 9998;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		border: 2px solid var(--gruv-orange);
		border-radius: var(--radius-pill);
		background: var(--gruv-bg0);
		padding: 0.45rem 0.9rem;
		color: var(--gruv-fg0);
		font-size: 0.8rem;
		box-shadow: var(--shadow-card);
	}
</style>
