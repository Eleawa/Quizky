<script lang="ts">
	import { parseQuestionSegments } from '#lib/shared/code-highlight.js';

	let {
		text,
		id = undefined,
		headingTag = 'h2',
		codeOnly = false,
		class: className = ''
	}: {
		text: string;
		id?: string;
		headingTag?: 'h1' | 'h2' | 'h3' | 'div';
		codeOnly?: boolean;
		class?: string;
	} = $props();

	let segments = $derived(
		codeOnly
			? parseQuestionSegments(text).filter((segment) => segment.type === 'code')
			: parseQuestionSegments(text)
	);
</script>

<div {id} class="question-prompt-block {className}">
	{#each segments as segment, idx (idx)}
		{#if segment.type === 'text'}
			{#if headingTag === 'h1'}
				<h1 class="question-prompt-heading">{segment.content}</h1>
			{:else if headingTag === 'h2'}
				<h2 class="question-prompt-heading">{segment.content}</h2>
			{:else if headingTag === 'h3'}
				<h3 class="question-prompt-heading">{segment.content}</h3>
			{:else}
				<div class="question-prompt-heading">{segment.content}</div>
			{/if}
		{:else if segment.type === 'code'}
			<div class="code-snippet-card">
				<pre class="code-snippet-pre"><code class="hljs"
						>{#each segment.tokens ?? [] as token, tIdx (tIdx)}{#if token.className}<span
									class={token.className}>{token.text}</span
								>{:else}{token.text}{/if}{/each}</code
					></pre>
			</div>
		{/if}
	{/each}
</div>

<style>
	.question-prompt-block {
		display: grid;
		gap: var(--space-3);
		width: 100%;
	}

	.question-prompt-heading {
		margin: 0;
		font-size: inherit;
		font-weight: 400;
		line-height: 1.3;
		white-space: pre-wrap;
		color: var(--color-heading);
	}

	.code-snippet-card {
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--gruv-bg-hard);
		color: var(--gruv-fg1);
		overflow: hidden;
		text-align: left;
		box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.35);
	}

	.code-snippet-pre {
		margin: 0;
		padding: 0.95rem 1.15rem;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: clamp(0.9rem, 1.6vw, 1.06rem);
		font-weight: 500;
		line-height: 1.55;
		tab-size: 2;
	}

	.code-snippet-pre code.hljs {
		display: block;
		font-family: inherit;
		white-space: pre;
		color: var(--gruv-fg1);
		background: transparent;
		padding: 0;
	}

	/* Authentic Gruvbox Dark Syntax Highlighting Palette */
	.code-snippet-pre :global(.hljs-keyword),
	.code-snippet-pre :global(.hljs-selector-tag),
	.code-snippet-pre :global(.hljs-section),
	.code-snippet-pre :global(.hljs-link) {
		color: var(--gruv-red);
		font-weight: 600;
	}

	.code-snippet-pre :global(.hljs-function .hljs-keyword) {
		color: var(--gruv-red);
	}

	.code-snippet-pre :global(.hljs-string),
	.code-snippet-pre :global(.hljs-regexp),
	.code-snippet-pre :global(.hljs-addition),
	.code-snippet-pre :global(.hljs-attribute),
	.code-snippet-pre :global(.hljs-meta .hljs-string) {
		color: var(--gruv-green);
	}

	.code-snippet-pre :global(.hljs-number),
	.code-snippet-pre :global(.hljs-literal) {
		color: var(--gruv-purple);
	}

	.code-snippet-pre :global(.hljs-built_in),
	.code-snippet-pre :global(.hljs-builtin-name),
	.code-snippet-pre :global(.hljs-type),
	.code-snippet-pre :global(.hljs-params),
	.code-snippet-pre :global(.hljs-meta) {
		color: var(--gruv-orange);
	}

	.code-snippet-pre :global(.hljs-title),
	.code-snippet-pre :global(.hljs-title.class_),
	.code-snippet-pre :global(.hljs-title.function_),
	.code-snippet-pre :global(.hljs-function) {
		color: var(--gruv-yellow);
		font-weight: 600;
	}

	.code-snippet-pre :global(.hljs-variable),
	.code-snippet-pre :global(.hljs-template-variable),
	.code-snippet-pre :global(.hljs-attr),
	.code-snippet-pre :global(.hljs-property) {
		color: var(--gruv-blue);
	}

	.code-snippet-pre :global(.hljs-comment),
	.code-snippet-pre :global(.hljs-quote) {
		color: var(--gruv-gray);
		font-style: italic;
	}

	.code-snippet-pre :global(.hljs-operator),
	.code-snippet-pre :global(.hljs-punctuation) {
		color: var(--gruv-aqua);
	}
</style>
