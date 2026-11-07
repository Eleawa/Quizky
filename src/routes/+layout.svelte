<script lang="ts">
	import './../styles/tokens.css';
	import './../styles/app.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#2857EC" />
</svelte:head>

{@render children()}
