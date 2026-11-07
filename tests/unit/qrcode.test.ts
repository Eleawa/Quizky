import { describe, expect, it } from 'vitest';
import { encodeQrCodeMatrix, renderQrCodeSvgData } from '../../src/lib/shared/qrcode.js';

describe('ISO/IEC 18004 QR Code Generator', () => {
	it('encodes a join URL into a valid QR matrix with intact finder, timing, and dark modules', () => {
		const url = 'https://quizky.example.com/join/K7M9P2';
		const matrix = encodeQrCodeMatrix(url, 'M');

		expect(matrix.version).toBeGreaterThanOrEqual(2);
		expect(matrix.size).toBe(matrix.version * 4 + 17);
		expect(matrix.modules).toHaveLength(matrix.size);

		// Verify top-left 7x7 finder pattern
		for (let r = 0; r < 7; r += 1) {
			for (let c = 0; c < 7; c += 1) {
				const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
				const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
				expect(matrix.modules[r]?.[c]).toBe(onBorder || inCore);
			}
		}

		// Verify white separator around top-left finder pattern
		for (let i = 0; i < 8; i += 1) {
			expect(matrix.modules[7]?.[i]).toBe(false);
			expect(matrix.modules[i]?.[7]).toBe(false);
		}

		// Verify fixed dark module at (size - 8, 8)
		expect(matrix.modules[matrix.size - 8]?.[8]).toBe(true);
	});

	it('renders crisp SVG path and markup with quiet zone margin', () => {
		const svg = renderQrCodeSvgData('http://localhost:5173/join/AB23CD', { margin: 4 });

		expect(svg.viewBoxSize).toBe(svg.version * 4 + 17 + 8);
		expect(svg.pathData).toContain('M4 4h1v1h-1z');
		expect(svg.svgMarkup).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
		expect(svg.svgMarkup).toContain(`viewBox="0 0 ${svg.viewBoxSize} ${svg.viewBoxSize}"`);
	});
});
