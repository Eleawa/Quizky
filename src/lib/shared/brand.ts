export const BRAND = {
	name: 'Quizky',
	tagline: 'Play. Think. Win.',
	colors: {
		electricBlue: '#2857EC',
		tangerine: '#FF6B35',
		sunshineYellow: '#FFD23F',
		freshGreen: '#29C785',
		midnight: '#20212A',
		white: '#FFFFFF'
	}
} as const;

export type Brand = typeof BRAND;
