import { gsap } from 'gsap';

function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined') return true;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface GsapRevealOptions {
	y?: number;
	duration?: number;
	delay?: number;
	scale?: number;
}

/**
 * Svelte action that animates an element's entrance with GSAP.
 */
export function gsapReveal(node: HTMLElement, options: GsapRevealOptions = {}) {
	if (prefersReducedMotion()) {
		return {};
	}

	const y = options.y ?? 18;
	const duration = options.duration ?? 0.48;
	const delay = options.delay ?? 0;
	const scale = options.scale ?? 0.985;

	const tween = gsap.fromTo(
		node,
		{
			autoAlpha: 0,
			y,
			scale
		},
		{
			autoAlpha: 1,
			y: 0,
			scale: 1,
			duration,
			delay,
			ease: 'power3.out',
			clearProps: 'transform,opacity,visibility'
		}
	);

	return {
		destroy() {
			tween.kill();
		}
	};
}

export interface GsapStaggerOptions {
	selector?: string;
	stagger?: number;
	y?: number;
	duration?: number;
	delay?: number;
}

/**
 * Svelte action that staggers direct children (or matching selector) on mount.
 */
export function gsapStagger(node: HTMLElement, options: GsapStaggerOptions = {}) {
	if (prefersReducedMotion()) {
		return {};
	}

	const selector = options.selector ?? ':scope > *';
	const targets = Array.from(node.querySelectorAll<HTMLElement>(selector));
	if (targets.length === 0) {
		return {};
	}

	const tween = gsap.fromTo(
		targets,
		{
			autoAlpha: 0,
			y: options.y ?? 16
		},
		{
			autoAlpha: 1,
			y: 0,
			duration: options.duration ?? 0.42,
			stagger: options.stagger ?? 0.055,
			delay: options.delay ?? 0.04,
			ease: 'power3.out',
			clearProps: 'transform,opacity,visibility'
		}
	);

	return {
		destroy() {
			tween.kill();
		}
	};
}

/**
 * Svelte action that gives a tactile spring pop entrance (ideal for modals, results, or badges).
 */
export function gsapPop(node: HTMLElement, delay: number = 0) {
	if (prefersReducedMotion()) {
		return {};
	}

	const tween = gsap.fromTo(
		node,
		{
			autoAlpha: 0,
			scale: 0.9,
			y: 10
		},
		{
			autoAlpha: 1,
			scale: 1,
			y: 0,
			duration: 0.4,
			delay,
			ease: 'back.out(1.6)',
			clearProps: 'transform,opacity,visibility'
		}
	);

	return {
		destroy() {
			tween.kill();
		}
	};
}

/**
 * Animates a main route container whenever the pathname changes.
 */
export function animateRouteEnter(container: HTMLElement | null): void {
	if (!container || prefersReducedMotion()) return;

	const panels = container.querySelectorAll<HTMLElement>(
		'.panel, .hero-card, .quiz-card, .session-row'
	);
	if (panels.length > 0) {
		gsap.fromTo(
			panels,
			{
				autoAlpha: 0,
				y: 16
			},
			{
				autoAlpha: 1,
				y: 0,
				duration: 0.42,
				stagger: 0.05,
				ease: 'power3.out',
				overwrite: 'auto',
				clearProps: 'transform,opacity,visibility'
			}
		);
	} else {
		gsap.fromTo(
			container,
			{ autoAlpha: 0, y: 12 },
			{
				autoAlpha: 1,
				y: 0,
				duration: 0.35,
				ease: 'power2.out',
				overwrite: 'auto',
				clearProps: 'transform,opacity,visibility'
			}
		);
	}
}
