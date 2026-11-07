<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { readApiError } from '#lib/shared/api-error.js';
	import { BRAND } from '#lib/shared/brand.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let displayName = $state('');
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
			const response = await fetch('/api/auth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ displayName, email, password })
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
	<title>Create your account — {BRAND.name}</title>
	<meta
		name="description"
		content="Create a Quizky teacher account to build quizzes and host games."
	/>
</svelte:head>

<div class="page">
	<SiteHeader />

	<main class="auth-page">
		<section class="panel auth-card" aria-labelledby="register-title">
			<p class="auth-eyebrow">Teacher access</p>
			<h1 id="register-title">Create your account</h1>
			<p class="auth-intro">Build quizzes, host live games, and keep results in one place.</p>

			<form class="auth-form" onsubmit={handleSubmit}>
				{#if formError}
					<p class="form-error" role="alert">{formError}</p>
				{/if}

				<div class="field">
					<label for="display-name">Display name</label>
					<input
						id="display-name"
						name="displayName"
						type="text"
						autocomplete="name"
						required
						minlength="2"
						maxlength="80"
						bind:value={displayName}
						aria-invalid={Boolean(fieldErrors.displayName)}
						aria-describedby={fieldErrors.displayName ? 'display-name-error' : undefined}
					/>
					{#if fieldErrors.displayName}
						<p class="field-error" id="display-name-error">{fieldErrors.displayName}</p>
					{/if}
				</div>

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
						autocomplete="new-password"
						required
						minlength="10"
						maxlength="128"
						bind:value={password}
						aria-invalid={Boolean(fieldErrors.password)}
						aria-describedby={fieldErrors.password ? 'password-error' : 'password-hint'}
					/>
					{#if fieldErrors.password}
						<p class="field-error" id="password-error">{fieldErrors.password}</p>
					{:else}
						<p class="field-hint" id="password-hint">At least 10 characters.</p>
					{/if}
				</div>

				<button class="button button-primary auth-submit" type="submit" disabled={pending}>
					{pending ? 'Creating account…' : 'Create account'}
				</button>
			</form>

			<p class="auth-switch">
				Already have an account?
				<a href={resolve(`/login?next=${encodeURIComponent(data.next)}`)}>Sign in</a>
			</p>
		</section>
	</main>

	<footer class="site-footer">
		<p>{BRAND.name} · {BRAND.tagline}</p>
	</footer>
</div>
