<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { readApiError } from '#lib/shared/api-error.js';
	import { BRAND } from '#lib/shared/brand.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let email = $state('');
	let password = $state('');
	let pending = $state(false);
	let formError = $state('');
	let fieldErrors = $state<Record<string, string>>({});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;

		pending = true;
		formError = '';
		fieldErrors = {};

		try {
			const response = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email, password })
			});

			if (!response.ok) {
				const apiError = await readApiError(response);
				formError = apiError.message;
				fieldErrors = apiError.fields;
				return;
			}

			await goto(resolve(data.next.slice(1) as 'dashboard'), {
				invalidateAll: true
			});
		} catch {
			formError = 'Could not reach the server. Try again.';
		} finally {
			pending = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in — {BRAND.name}</title>
	<meta name="description" content="Sign in to your Quizky teacher account." />
</svelte:head>

<div class="page">
	<SiteHeader />

	<main class="auth-page">
		<section class="panel auth-card" aria-labelledby="login-title">
			<p class="auth-eyebrow">Teacher access</p>
			<h1 id="login-title">Welcome back</h1>
			<p class="auth-intro">Sign in to build quizzes and host live games.</p>

			<form class="auth-form" onsubmit={handleSubmit}>
				{#if formError}
					<p class="form-error" role="alert">{formError}</p>
				{/if}

				<div class="field">
					<label for="email">Email</label>
					<input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						required
						bind:value={email}
						aria-invalid={Boolean(fieldErrors.email)}
						aria-describedby={fieldErrors.email ? 'email-error' : undefined}
					/>
					{#if fieldErrors.email}
						<p class="field-error" id="email-error">{fieldErrors.email}</p>
					{/if}
				</div>

				<div class="field">
					<label for="password">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						required
						bind:value={password}
						aria-invalid={Boolean(fieldErrors.password)}
						aria-describedby={fieldErrors.password ? 'password-error' : undefined}
					/>
					{#if fieldErrors.password}
						<p class="field-error" id="password-error">{fieldErrors.password}</p>
					{/if}
				</div>

				<button class="button button-primary auth-submit" type="submit" disabled={pending}>
					{pending ? 'Signing in…' : 'Sign in'}
				</button>
			</form>

			<p class="auth-switch">
				New to {BRAND.name}?
				<a href={resolve(`/register?next=${encodeURIComponent(data.next)}`)}>Create an account</a>
			</p>
		</section>
	</main>

	<footer class="site-footer">
		<p>{BRAND.name} · {BRAND.tagline}</p>
	</footer>
</div>
