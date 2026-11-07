<script lang="ts">
	import { renderQrCodeSvgData } from '#lib/shared/qrcode.js';

	interface Props {
		open: boolean;
		quizTitle: string;
		joinCode: string;
		joinUrl: string;
		onClose: () => void;
	}

	let { open, quizTitle, joinCode, joinUrl, onClose }: Props = $props();

	let copiedLink = $state(false);
	let copiedCode = $state(false);

	let qrData = $derived(renderQrCodeSvgData(joinUrl || joinCode));

	async function copyValue(value: string, kind: 'link' | 'code') {
		try {
			await navigator.clipboard.writeText(value);
			if (kind === 'link') {
				copiedLink = true;
				setTimeout(() => (copiedLink = false), 2000);
			} else {
				copiedCode = true;
				setTimeout(() => (copiedCode = false), 2000);
			}
		} catch {
			// Clipboard API unavailable.
		}
	}

	function downloadSvg() {
		const blob = new Blob([qrData.svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `quizky-${joinCode.toLowerCase()}-qr.svg`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}

	function downloadPng() {
		const sizePx = 1024;
		const img = new Image();
		const svgBlob = new Blob([qrData.svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
		const url = URL.createObjectURL(svgBlob);

		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = sizePx;
			canvas.height = sizePx;
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.imageSmoothingEnabled = false;
				ctx.drawImage(img, 0, 0, sizePx, sizePx);
				const pngUrl = canvas.toDataURL('image/png');
				const link = document.createElement('a');
				link.href = pngUrl;
				link.download = `quizky-${joinCode.toLowerCase()}-qr.png`;
				document.body.appendChild(link);
				link.click();
				link.remove();
			}
			URL.revokeObjectURL(url);
		};
		img.src = url;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="qr-modal-backdrop"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) onClose();
		}}
	>
		<div
			class="qr-modal-dialog panel"
			role="dialog"
			aria-modal="true"
			aria-labelledby="qr-modal-title"
		>
			<div class="qr-modal-header">
				<div>
					<p class="auth-eyebrow">Scan to join quiz</p>
					<h2 id="qr-modal-title">{quizTitle}</h2>
				</div>
				<button
					class="button button-secondary button-small"
					type="button"
					onclick={onClose}
					aria-label="Close QR code modal"
				>
					✕ Close
				</button>
			</div>

			<div class="qr-modal-body">
				<div class="qr-frame" aria-label="QR code for {joinUrl}">
					<svg
						viewBox="0 0 {qrData.viewBoxSize} {qrData.viewBoxSize}"
						shape-rendering="crispEdges"
						class="qr-svg"
						role="img"
						aria-label="Join quiz QR code"
					>
						<rect width={qrData.viewBoxSize} height={qrData.viewBoxSize} fill="#ffffff" />
						<path d={qrData.pathData} fill="#111827" />
					</svg>
				</div>

				<div class="qr-join-details">
					<div class="qr-code-pill">
						<span class="qr-code-pill-label">Join Code</span>
						<strong class="qr-code-pill-value">{joinCode}</strong>
						<button
							class="button button-secondary button-small"
							type="button"
							onclick={() => copyValue(joinCode, 'code')}
						>
							{copiedCode ? '✓ Copied' : 'Copy code'}
						</button>
					</div>

					<p class="qr-url-display">
						<code>{joinUrl}</code>
					</p>
				</div>
			</div>

			<div class="qr-modal-actions">
				<button class="button button-primary" type="button" onclick={downloadPng}>
					Download QR (PNG)
				</button>
				<button class="button button-secondary" type="button" onclick={downloadSvg}>
					Download SVG
				</button>
				<button
					class="button button-secondary"
					type="button"
					onclick={() => copyValue(joinUrl, 'link')}
				>
					{copiedLink ? '✓ Copied join link' : 'Copy join link'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.qr-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		padding: var(--space-4);
		background: rgba(15, 23, 42, 0.65);
		backdrop-filter: blur(4px);
	}

	.qr-modal-dialog {
		display: grid;
		gap: var(--space-5);
		width: min(32rem, 100%);
		max-height: 92vh;
		overflow-y: auto;
		padding: var(--space-5);
		text-align: center;
		box-shadow: 0 24px 48px rgba(0, 0, 0, 0.22);
	}

	.qr-modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		text-align: left;
	}

	.qr-modal-header h2 {
		font-size: clamp(1.25rem, 2.5vw, 1.6rem);
		margin: 0;
	}

	.qr-modal-body {
		display: grid;
		justify-items: center;
		gap: var(--space-4);
	}

	.qr-frame {
		display: grid;
		place-items: center;
		width: min(20rem, 72vw);
		aspect-ratio: 1 / 1;
		border: 3px solid var(--color-brand);
		border-radius: var(--radius-lg);
		background: #ffffff;
		padding: var(--space-2);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
	}

	.qr-svg {
		width: 100%;
		height: 100%;
		display: block;
	}

	.qr-join-details {
		display: grid;
		gap: var(--space-2);
		width: 100%;
	}

	.qr-code-pill {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		border: 2px solid var(--color-brand);
		border-radius: var(--radius-md);
		background: var(--color-tint);
		padding: var(--space-2) var(--space-4);
		margin-inline: auto;
	}

	.qr-code-pill-label {
		color: var(--color-brand);
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.qr-code-pill-value {
		font-family: var(--font-display);
		font-size: 1.65rem;
		font-weight: 900;
		letter-spacing: 0.12em;
	}

	.qr-url-display {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.88rem;
		word-break: break-all;
	}

	.qr-modal-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-4);
	}
</style>
