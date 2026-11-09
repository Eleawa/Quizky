<script lang="ts">
	import { gsap } from 'gsap';
	import { onMount } from 'svelte';

	function prefersReducedMotion(): boolean {
		if (typeof window === 'undefined') return true;
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	let patternRef: SVGPatternElement | null = $state(null);

	onMount(() => {
		if (prefersReducedMotion() || !patternRef) return;

		// Extremely slow, gentle ambient drift (120s for a full 460px seamless loop)
		gsap.to(patternRef, {
			attr: { x: 460, y: 460 },
			duration: 120,
			ease: 'none',
			repeat: -1
		});

		return () => {
			if (patternRef) {
				gsap.killTweensOf(patternRef);
			}
		};
	});
</script>

<div class="whatsapp-doodle-layer" aria-hidden="true">
	<svg class="whatsapp-doodle-svg" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<pattern
				bind:this={patternRef}
				id="whatsapp-doodle-pattern"
				width="460"
				height="460"
				patternUnits="userSpaceOnUse"
			>
				<g
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<!-- Row 0 -->
					<!-- 1. Lightbulb (x: 18, y: 16, rot: -12) -->
					<g transform="translate(18, 16) rotate(-12, 16, 16)">
						<path
							d="M11 13a5 5 0 1 1 10 0c0 2.5-2 4-2 6h-6c0-2-2-3.5-2-6zM13 21h6M14 24h4M16 3v2M5 8l1.5 1.5M27 8l-1.5 1.5M3 15h2M27 15h2"
						/>
					</g>
					<!-- 2. Coffee Mug (x: 82, y: 22, rot: 8) -->
					<g transform="translate(82, 22) rotate(8, 16, 16)">
						<path
							d="M7 11h14v9a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5v-9zM21 13h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-3M10 5c0 2-1 3-1 4M14 4c0 2-1 3-1 4M18 5c0 2-1 3-1 4"
						/>
					</g>
					<!-- 3. Lightning (x: 146, y: 14, rot: -15) -->
					<g transform="translate(146, 14) rotate(-15, 16, 16)">
						<path d="M18 3L8 17h8l-2 12 12-16h-8l4-10z" />
					</g>
					<!-- 4. Chat Bubble (x: 212, y: 20, rot: 6) -->
					<g transform="translate(212, 20) rotate(6, 16, 16)">
						<path
							d="M5 6h22a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3h-8l-6 5v-5H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3zM8 12h14M8 17h9"
						/>
					</g>
					<!-- 5. Star Sparkle (x: 278, y: 16, rot: 14) -->
					<g transform="translate(278, 16) rotate(14, 16, 16)">
						<path
							d="M16 4c0 6-5 12-12 12 7 0 12 6 12 12 0-6 5-12 12-12-7 0-12-6-12-12zM26 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM6 26a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"
						/>
					</g>
					<!-- 6. Rocket Ship (x: 344, y: 22, rot: -20) -->
					<g transform="translate(344, 22) rotate(-20, 16, 16)">
						<path
							d="M16 4c4 3 7 8 7 15l-4 4-4-2-4 2-4-4c0-7 3-12 7-15zM8 19l-5 4v3l5-1M24 19l5 4v3l-5-1M16 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM14 27l2 4 2-4"
						/>
					</g>
					<!-- 7. Question Mark (x: 410, y: 16, rot: 10) -->
					<g transform="translate(410, 16) rotate(10, 16, 16)">
						<circle cx="16" cy="16" r="13" />
						<path d="M13 12a3 3 0 0 1 5.5 1.5c0 2-3 2.8-3 4.5v1M16 23.5v.5" />
					</g>

					<!-- Row 1 -->
					<!-- 8. Headphones (x: 20, y: 80, rot: 12) -->
					<g transform="translate(20, 80) rotate(12, 16, 16)">
						<path
							d="M6 18A10 10 0 0 1 26 18v7a3 3 0 0 1-3 3h-1a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3h4M6 18h4a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-7z"
						/>
					</g>
					<!-- 9. Pencil (x: 84, y: 86, rot: -28) -->
					<g transform="translate(84, 86) rotate(-28, 16, 16)">
						<path d="M25 5l2 2-15 15-4 1 1-4 15-15zM22 8l2 2M5 28c3-1 5 1 8 0s5-1 8 0" />
					</g>
					<!-- 10. Heart (x: 148, y: 78, rot: 8) -->
					<g transform="translate(148, 78) rotate(8, 16, 16)">
						<path
							d="M16 27s-10-6.5-10-13a5.5 5.5 0 0 1 10-3 5.5 5.5 0 0 1 10 3c0 6.5-10 13-10 13z"
						/>
					</g>
					<!-- 11. Science Flask (x: 214, y: 84, rot: -10) -->
					<g transform="translate(214, 84) rotate(-10, 16, 16)">
						<path
							d="M13 4h6M14 4v7L6 24a3 3 0 0 0 2.5 4h15a3 3 0 0 0 2.5-4L18 11V4M9 22c3-1.5 5 1.5 8 0s5-1.5 7 0"
						/>
						<circle cx="15" cy="18" r="1" />
					</g>
					<!-- 12. Padlock (x: 280, y: 80, rot: 6) -->
					<g transform="translate(280, 80) rotate(6, 16, 16)">
						<rect x="7" y="13" width="18" height="14" rx="3" />
						<path d="M11 13V9a5 5 0 0 1 10 0v4M16 18v4" />
					</g>
					<!-- 13. Music Notes (x: 346, y: 86, rot: -15) -->
					<g transform="translate(346, 86) rotate(-15, 16, 16)">
						<path
							d="M10 24V9l14-3v15M10 15l14-3M10 24a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM24 21a3 3 0 1 1-3-3 3 3 0 0 1 3 3z"
						/>
					</g>
					<!-- 14. Trophy Cup (x: 412, y: 78, rot: 14) -->
					<g transform="translate(412, 78) rotate(14, 16, 16)">
						<path
							d="M9 5h14v10a7 7 0 0 1-14 0V5zM16 22v5M11 30h10M9 8H5a4 4 0 0 0 4 5M23 8h4a4 4 0 0 1-4 5M16 9l.8 1.6 1.8.3-1.3 1.3.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.3 1.8-.3L16 9z"
						/>
					</g>

					<!-- Row 2 -->
					<!-- 15. Paper Plane (x: 16, y: 146, rot: -8) -->
					<g transform="translate(16, 146) rotate(-8, 16, 16)">
						<path d="M4 15l24-10-10 24-4-9-10-5zM14 20l7-10" />
					</g>
					<!-- 16. Camera (x: 80, y: 152, rot: 15) -->
					<g transform="translate(80, 152) rotate(15, 16, 16)">
						<path
							d="M5 9h5l2-3h8l2 3h5a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3z"
						/>
						<circle cx="16" cy="18" r="5" />
						<circle cx="24" cy="12" r="1" />
					</g>
					<!-- 17. Scholar Cap (x: 146, y: 142, rot: -18) -->
					<g transform="translate(146, 142) rotate(-18, 16, 16)">
						<path
							d="M16 6L3 13l13 7 13-7-13-7zM7 16v7c0 3 4 5 9 5s9-2 9-5v-7M26 14v10c-1 1-3 1-3 0V14"
						/>
					</g>
					<!-- 18. Gamepad (x: 212, y: 148, rot: 10) -->
					<g transform="translate(212, 148) rotate(10, 16, 16)">
						<rect x="4" y="9" width="24" height="15" rx="7" />
						<path d="M9 16.5h4M11 14.5v4M21 15h.5M23.5 17.5h.5" />
					</g>
					<!-- 19. Magnifier (x: 278, y: 144, rot: -25) -->
					<g transform="translate(278, 144) rotate(-25, 16, 16)">
						<circle cx="14" cy="14" r="8" />
						<path d="M20 20l8 8" />
					</g>
					<!-- 20. Atom Orbit (x: 344, y: 150, rot: 16) -->
					<g transform="translate(344, 150) rotate(16, 16, 16)">
						<ellipse cx="16" cy="16" rx="13" ry="5" transform="rotate(-30 16 16)" />
						<ellipse cx="16" cy="16" rx="13" ry="5" transform="rotate(30 16 16)" />
						<circle cx="16" cy="16" r="2" fill="currentColor" />
					</g>
					<!-- 21. Diamond Gem (x: 410, y: 144, rot: -10) -->
					<g transform="translate(410, 144) rotate(-10, 16, 16)">
						<path d="M10 5h12l6 7-12 15L4 12l6-7zM4 12h24M10 5l6 22 6-22M16 5v22" />
					</g>

					<!-- Row 3 -->
					<!-- 22. Clock (x: 22, y: 212, rot: 14) -->
					<g transform="translate(22, 212) rotate(14, 16, 16)">
						<circle cx="16" cy="16" r="12" />
						<path d="M16 9v7l5 3M14 2h4" />
					</g>
					<!-- 23. Envelope (x: 86, y: 218, rot: -12) -->
					<g transform="translate(86, 218) rotate(-12, 16, 16)">
						<rect x="4" y="7" width="24" height="18" rx="3" />
						<path d="M4 10l12 9 12-9" />
					</g>
					<!-- 24. Saturn Planet (x: 150, y: 210, rot: 20) -->
					<g transform="translate(150, 210) rotate(20, 16, 16)">
						<circle cx="16" cy="16" r="7" />
						<path
							d="M4 19c2.5-3 7-5 13-5 5.5 0 9.5 1.5 11 4M7 14c-1.5 1-2.5 2.5-2 3.5 1 2 5.5 3.5 11 3.5s10-1.5 11-3.5c.5-1-.5-2.5-2-3.5"
						/>
					</g>
					<!-- 25. Checkmark Badge (x: 216, y: 216, rot: -6) -->
					<g transform="translate(216, 216) rotate(-6, 16, 16)">
						<circle cx="16" cy="16" r="11" />
						<path d="M11 16l3.5 3.5 7.5-7.5M16 2v2M30 16h-2M16 30v-2M2 16h2" />
					</g>
					<!-- 26. Open Book (x: 282, y: 212, rot: 15) -->
					<g transform="translate(282, 212) rotate(15, 16, 16)">
						<path d="M16 9c-3-2-7-2-12 0v16c5-2 9-2 12 0 3-2 7-2 12 0V9c-5-2-9-2-12 0zM16 9v16" />
					</g>
					<!-- 27. Bell (x: 348, y: 218, rot: -14) -->
					<g transform="translate(348, 218) rotate(-14, 16, 16)">
						<path
							d="M16 5a5 5 0 0 0-5 5v5l-3 4h16l-3-4v-5a5 5 0 0 0-5-5zM14 24a2 2 0 0 0 4 0M16 3v2"
						/>
					</g>
					<!-- 28. Key (x: 414, y: 210, rot: 24) -->
					<g transform="translate(414, 210) rotate(24, 16, 16)">
						<circle cx="11" cy="16" r="6" />
						<path d="M17 16h11M23 16v3M26 16v2" />
					</g>

					<!-- Row 4 -->
					<!-- 29. Microphone (x: 18, y: 278, rot: -10) -->
					<g transform="translate(18, 278) rotate(-10, 16, 16)">
						<rect x="11" y="4" width="10" height="15" rx="5" />
						<path d="M7 13a9 9 0 0 0 18 0M16 22v6M11 28h10" />
					</g>
					<!-- 30. Sun (x: 84, y: 284, rot: 18) -->
					<g transform="translate(84, 284) rotate(18, 16, 16)">
						<circle cx="16" cy="16" r="6" />
						<path
							d="M16 3v3M16 26v3M3 16h3M26 16h3M6.8 6.8l2.1 2.1M23.1 23.1l2.1 2.1M6.8 25.2l2.1-2.1M23.1 8.9l2.1-2.1"
						/>
					</g>
					<!-- 31. Crown (x: 148, y: 276, rot: -16) -->
					<g transform="translate(148, 276) rotate(-16, 16, 16)">
						<path
							d="M5 23l2-13 6 6 3-8 3 8 6-6 2 13H5zM16 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM7 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM25 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"
						/>
					</g>
					<!-- 32. Speech Bubble Tail (x: 214, y: 282, rot: 8) -->
					<g transform="translate(214, 282) rotate(8, 16, 16)">
						<path
							d="M26 7H6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h3l-2 5 6-5h13a3 3 0 0 0 3-3V10a3 3 0 0 0-3-3z"
						/>
					</g>
					<!-- 33. Calculator (x: 280, y: 278, rot: -8) -->
					<g transform="translate(280, 278) rotate(-8, 16, 16)">
						<rect x="6" y="4" width="20" height="24" rx="4" />
						<rect x="9" y="7" width="14" height="5" rx="1" />
						<path d="M10 16h2M15 16h2M20 16h2M10 20h2M15 20h2M20 20h2M10 24h2M15 24h2M20 24h2" />
					</g>
					<!-- 34. Direction Compass (x: 346, y: 284, rot: 22) -->
					<g transform="translate(346, 284) rotate(22, 16, 16)">
						<circle cx="16" cy="16" r="12" />
						<polygon points="16,8 20,16 16,14 12,16" />
						<polygon points="16,24 12,16 16,18 20,16" />
					</g>
					<!-- 35. Spiral Coil (x: 412, y: 276, rot: -14) -->
					<g transform="translate(412, 276) rotate(-14, 16, 16)">
						<path d="M6 16c0-5.5 4.5-10 10-10s10 4.5 10 10-3.5 8-8 8-6-3-6-6 2-4 5-4 3 1.5 3 3" />
					</g>

					<!-- Row 5 -->
					<!-- 36. Bullseye Target (x: 20, y: 344, rot: 16) -->
					<g transform="translate(20, 344) rotate(16, 16, 16)">
						<circle cx="16" cy="16" r="12" />
						<circle cx="16" cy="16" r="7" />
						<circle cx="16" cy="16" r="2" fill="currentColor" />
					</g>
					<!-- 37. Moon with Star (x: 84, y: 350, rot: -20) -->
					<g transform="translate(84, 350) rotate(-20, 16, 16)">
						<path
							d="M14 5a12 12 0 1 0 12 12 10 10 0 0 1-12-12zM23 7l.7 1.4 1.5.2-1.1 1 .3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1 1.5-.2L23 7z"
						/>
					</g>
					<!-- 38. Hourglass (x: 148, y: 342, rot: 10) -->
					<g transform="translate(148, 342) rotate(10, 16, 16)">
						<path
							d="M8 5h16M8 27h16M10 5l6 8-6 14M22 5l-6 8 6 14M13 23c2-1 4-1 6 0M16 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"
						/>
					</g>
					<!-- 39. Artist Palette (x: 214, y: 348, rot: -12) -->
					<g transform="translate(214, 348) rotate(-12, 16, 16)">
						<path
							d="M16 5C9.4 5 4 10.4 4 17c0 4 2.5 6 6 6 1.5 0 2.5-.5 3.5-.5s2 1 2 2.5c0 2.5 1.5 4 4.5 4 6.6 0 12-5.4 12-12C32 10.4 24.8 5 16 5z"
						/>
						<circle cx="10" cy="12" r="1.5" fill="currentColor" />
						<circle cx="16" cy="9" r="1.5" fill="currentColor" />
						<circle cx="22" cy="12" r="1.5" fill="currentColor" />
					</g>
					<!-- 40. Umbrella (x: 280, y: 344, rot: 14) -->
					<g transform="translate(280, 344) rotate(14, 16, 16)">
						<path d="M5 16c0-6 5-11 11-11s11 5 11 11H5zM16 5V3M16 16v8a3 3 0 0 0 6 0" />
					</g>
					<!-- 41. Rain Cloud (x: 346, y: 350, rot: -8) -->
					<g transform="translate(346, 350) rotate(-8, 16, 16)">
						<path
							d="M7 19a6 6 0 0 1 11-3 5 5 0 0 1 8 3 4 4 0 0 1-2 7H7a5 5 0 0 1 0-7zM9 25l-2 4M14 25l-2 4M19 25l-2 4M24 25l-2 4"
						/>
					</g>
					<!-- 42. Thumbs Up (x: 412, y: 342, rot: 20) -->
					<g transform="translate(412, 342) rotate(20, 16, 16)">
						<path
							d="M6 13h4v14H6zM10 16l4-8a2 2 0 0 1 3 2l-1 4h7a2 2 0 0 1 2 2v2l-3 8a2 2 0 0 1-2 1H10"
						/>
					</g>

					<!-- Row 6 -->
					<!-- 43. Bicycle (x: 18, y: 410, rot: -6) -->
					<g transform="translate(18, 410) rotate(-6, 16, 16)">
						<circle cx="8" cy="20" r="5" />
						<circle cx="24" cy="20" r="5" />
						<path d="M8 20l6-8h4l6 8M14 12l2 8M12 9h4M22 14h3" />
					</g>
					<!-- 44. Dice (x: 84, y: 416, rot: 15) -->
					<g transform="translate(84, 416) rotate(15, 16, 16)">
						<rect x="6" y="6" width="20" height="20" rx="4" />
						<circle cx="11" cy="11" r="1.2" fill="currentColor" />
						<circle cx="21" cy="11" r="1.2" fill="currentColor" />
						<circle cx="16" cy="16" r="1.2" fill="currentColor" />
						<circle cx="11" cy="21" r="1.2" fill="currentColor" />
						<circle cx="21" cy="21" r="1.2" fill="currentColor" />
					</g>
					<!-- 45. Scissors (x: 148, y: 408, rot: -22) -->
					<g transform="translate(148, 408) rotate(-22, 16, 16)">
						<circle cx="9" cy="10" r="4" />
						<circle cx="9" cy="22" r="4" />
						<path d="M12 12l15 11M12 20L27 9" />
					</g>
					<!-- 46. Plant Leaf (x: 214, y: 414, rot: 12) -->
					<g transform="translate(214, 414) rotate(12, 16, 16)">
						<path d="M6 26c0-10 10-20 20-20 0 10-10 20-20 20zM6 26l9-9" />
					</g>
					<!-- 47. Anchor (x: 280, y: 410, rot: -10) -->
					<g transform="translate(280, 410) rotate(-10, 16, 16)">
						<circle cx="16" cy="8" r="3" />
						<path d="M16 11v16M11 15h10M6 20c0 6 4.5 10 10 10s10-4 10-10M5 19l2 2M27 19l-2 2" />
					</g>
					<!-- 48. Clapperboard (x: 346, y: 416, rot: 18) -->
					<g transform="translate(346, 416) rotate(18, 16, 16)">
						<rect x="4" y="9" width="24" height="18" rx="3" />
						<path d="M4 14h24M9 9l2 5M15 9l2 5M21 9l2 5" />
					</g>
					<!-- 49. Exclamation Mark (x: 412, y: 408, rot: -14) -->
					<g transform="translate(412, 408) rotate(-14, 16, 16)">
						<circle cx="16" cy="16" r="13" />
						<path d="M16 9v8M16 22v.5" />
					</g>
				</g>
			</pattern>
		</defs>
		<rect width="100%" height="100%" fill="url(#whatsapp-doodle-pattern)" />
	</svg>
</div>

<style>
	.whatsapp-doodle-layer {
		position: fixed;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 0;
		user-select: none;
	}

	.whatsapp-doodle-svg {
		display: block;
		width: 100%;
		height: 100%;
		color: var(--color-ink);
		opacity: 0.065;
		transition:
			opacity 250ms ease,
			color 250ms ease;
	}

	:global([data-bs-theme='light']) .whatsapp-doodle-svg {
		opacity: 0.055;
	}
</style>
