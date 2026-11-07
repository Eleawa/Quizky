<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { readApiError } from '#lib/shared/api-error.js';
	import { BRAND } from '#lib/shared/brand.js';
	import {
		JOIN_CODE_LENGTH,
		NICKNAME_LIMITS,
		type StudentJoinResponse
	} from '#lib/shared/session.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function initialCode(): string {
		return data.code;
	}

	let joinCode = $state(initialCode());
	let nickname = $state('');
	let pending = $state(false);
	let formError = $state('');
	let fieldErrors = $state<Record<string, string>>({});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;

		const cleanCode = joinCode.trim().toUpperCase();
		if (cleanCode.length !== JOIN_CODE_LENGTH) {
			fieldErrors = { joinCode: 'Enter a valid 6-character join code.' };
			return;
		}

		pending = true;
		formError = '';
		fieldErrors = {};

		try {
			const response = await fetch(`/api/sessions/${encodeURIComponent(cleanCode)}/join`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ nickname })
			});

			if (!response.ok) {
				const apiError = await readApiError(response);
				formError = apiError.message;
				fieldErrors = apiError.fields;
				return;
			}

			const body = (await response.json()) as { session: StudentJoinResponse };
			try {
				sessionStorage.setItem(
					`quizky_pt_${body.session.sessionId}`,
					body.session.participantToken
				);
			} catch {
				// sessionStorage may be blocked in restricted contexts; cookie fallback still works.
			}

			await goto(resolve('/play/[code]', { code: body.session.joinCode }), {
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
	<title>Join game {data.code} — {BRAND.name}</title>
</svelte:head>

<div class="page">
	<SiteHeader teacher={data.teacher} />

	<main class="auth-page">
		<section class="panel auth-card" aria-labelledby="join-title">
			<p class="auth-eyebrow">Join live quiz</p>
			<h1 id="join-title">Enter the lobby</h1>

			{#if data.session}
				<p class="auth-intro">
					Joining <strong>{data.session.quizTitle}</strong> ({data.session.questionCount}
					{data.session.questionCount === 1 ? 'question' : 'questions'}).
				</p>
			{:else}
				<p class="auth-intro">
					Enter your teacher's 6-character join code and choose a nickname for the game.
				</p>
			{/if}

			{#if data.session && data.session.status !== 'lobby'}
				<p class="form-error" role="alert">
					This session is no longer accepting new players ({data.session.status}).
				</p>
			{/if}

			<form class="auth-form" onsubmit={handleSubmit} novalidate>
				{#if formError}
					<p class="form-error" role="alert">{formError}</p>
				{/if}

				<div class="field">
					<label for="join-code">Join code</label>
					<input
						id="join-code"
						name="joinCode"
						type="text"
						class="code-input"
						maxlength={JOIN_CODE_LENGTH}
						autocapitalize="characters"
						autocomplete="off"
						spellcheck="false"
						bind:value={joinCode}
						aria-invalid={fieldErrors.joinCode ? 'true' : undefined}
						required
					/>
					{#if fieldErrors.joinCode}
						<p class="field-error">{fieldErrors.joinCode}</p>
					{/if}
				</div>

				<div class="field">
					<label for="join-nickname">Your nickname</label>
					<input
						id="join-nickname"
						name="nickname"
						type="text"
						minlength={NICKNAME_LIMITS.minLength}
						maxlength={NICKNAME_LIMITS.maxLength}
						placeholder="e.g. Lightning Fox"
						autocomplete="nickname"
						bind:value={nickname}
						aria-invalid={fieldErrors.nickname ? 'true' : undefined}
						required
					/>
					<span class="field-hint">
						{NICKNAME_LIMITS.minLength}–{NICKNAME_LIMITS.maxLength} characters. Must be unique in this
						session.
					</span>
					{#if fieldErrors.nickname}
						<p class="field-error">{fieldErrors.nickname}</p>
					{/if}
				</div>

				<button
					class="button button-primary auth-submit"
					type="submit"
					disabled={pending || (data.session !== null && data.session.status !== 'lobby')}
				>
					{pending ? 'Joining lobby…' : 'Join game'}
				</button>
			</form>
		</section>
	</main>

	<footer class="site-footer">
		<p>{BRAND.name} · {BRAND.tagline}</p>
	</footer>
</div>

<style>
	.code-input {
		font-weight: 900;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
</style>
