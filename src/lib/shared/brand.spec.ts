import { describe, expect, it } from 'vitest';
import { BRAND } from './brand.js';

describe('brand tokens', () => {
	it('matches the Quizky specification', () => {
		expect(BRAND.name).toBe('Quizky');
		expect(BRAND.tagline).toBe('Play. Think. Win.');
		expect(BRAND.colors).toEqual({
			electricBlue: '#2857EC',
			tangerine: '#FF6B35',
			sunshineYellow: '#FFD23F',
			freshGreen: '#29C785',
			midnight: '#20212A',
			white: '#FFFFFF'
		});
	});
});
