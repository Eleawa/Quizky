/**
 * Zero-dependency ISO/IEC 18004 QR Code Matrix & SVG Generator.
 * Supports Byte mode (UTF-8) across Versions 1–10 with Error Correction Level M / L.
 */

export type QrErrorCorrectionLevel = 'L' | 'M';

export interface QrCodeMatrix {
	version: number;
	size: number;
	modules: boolean[][];
}

interface VersionSpec {
	totalCodewords: number;
	alignmentCoords: number[];
	ec: Record<QrErrorCorrectionLevel, { ecPerBlock: number; numBlocks: number }>;
}

const VERSION_SPECS: Record<number, VersionSpec> = {
	1: {
		totalCodewords: 26,
		alignmentCoords: [],
		ec: { L: { ecPerBlock: 7, numBlocks: 1 }, M: { ecPerBlock: 10, numBlocks: 1 } }
	},
	2: {
		totalCodewords: 44,
		alignmentCoords: [6, 18],
		ec: { L: { ecPerBlock: 10, numBlocks: 1 }, M: { ecPerBlock: 16, numBlocks: 1 } }
	},
	3: {
		totalCodewords: 70,
		alignmentCoords: [6, 22],
		ec: { L: { ecPerBlock: 15, numBlocks: 1 }, M: { ecPerBlock: 26, numBlocks: 1 } }
	},
	4: {
		totalCodewords: 100,
		alignmentCoords: [6, 26],
		ec: { L: { ecPerBlock: 20, numBlocks: 1 }, M: { ecPerBlock: 18, numBlocks: 2 } }
	},
	5: {
		totalCodewords: 134,
		alignmentCoords: [6, 30],
		ec: { L: { ecPerBlock: 26, numBlocks: 1 }, M: { ecPerBlock: 24, numBlocks: 2 } }
	},
	6: {
		totalCodewords: 172,
		alignmentCoords: [6, 34],
		ec: { L: { ecPerBlock: 18, numBlocks: 2 }, M: { ecPerBlock: 16, numBlocks: 4 } }
	},
	7: {
		totalCodewords: 196,
		alignmentCoords: [6, 22, 38],
		ec: { L: { ecPerBlock: 20, numBlocks: 2 }, M: { ecPerBlock: 18, numBlocks: 4 } }
	},
	8: {
		totalCodewords: 242,
		alignmentCoords: [6, 24, 42],
		ec: { L: { ecPerBlock: 24, numBlocks: 2 }, M: { ecPerBlock: 22, numBlocks: 4 } }
	},
	9: {
		totalCodewords: 292,
		alignmentCoords: [6, 26, 46],
		ec: { L: { ecPerBlock: 30, numBlocks: 2 }, M: { ecPerBlock: 22, numBlocks: 5 } }
	},
	10: {
		totalCodewords: 346,
		alignmentCoords: [6, 28, 50],
		ec: { L: { ecPerBlock: 18, numBlocks: 4 }, M: { ecPerBlock: 26, numBlocks: 5 } }
	}
};

function gfMultiply(x: number, y: number): number {
	let z = 0;
	for (let i = 7; i >= 0; i -= 1) {
		z = (z << 1) ^ ((z >>> 7) * 0x11d);
		z ^= ((y >>> i) & 1) * x;
	}
	return z;
}

function rsComputeDivisor(degree: number): Uint8Array {
	const result = new Uint8Array(degree);
	result[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i += 1) {
		for (let j = 0; j < degree; j += 1) {
			result[j] = gfMultiply(result[j]!, root);
			if (j + 1 < degree) {
				result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
			}
		}
		root = gfMultiply(root, 0x02);
	}
	return result;
}

function rsComputeRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
	const result = new Uint8Array(divisor.length);
	for (const byte of data) {
		const factor = byte ^ result[0]!;
		result.copyWithin(0, 1);
		result[result.length - 1] = 0;
		for (let i = 0; i < divisor.length; i += 1) {
			result[i] = (result[i] ?? 0) ^ gfMultiply(divisor[i]!, factor);
		}
	}
	return result;
}

function appendBits(val: number, len: number, bitBuffer: number[]): void {
	for (let i = len - 1; i >= 0; i -= 1) {
		bitBuffer.push((val >>> i) & 1);
	}
}

function getDataCapacityBytes(version: number, ecLevel: QrErrorCorrectionLevel): number {
	const spec = VERSION_SPECS[version]!;
	const ecInfo = spec.ec[ecLevel];
	const dataCodewords = spec.totalCodewords - ecInfo.ecPerBlock * ecInfo.numBlocks;
	const countBits = version <= 9 ? 8 : 16;
	return Math.floor((dataCodewords * 8 - 4 - countBits) / 8);
}

function selectVersionAndEc(
	byteLength: number,
	preferredEc: QrErrorCorrectionLevel
): { version: number; ecLevel: QrErrorCorrectionLevel } {
	for (let v = 1; v <= 10; v += 1) {
		if (getDataCapacityBytes(v, preferredEc) >= byteLength) {
			return { version: v, ecLevel: preferredEc };
		}
	}
	if (preferredEc !== 'L') {
		for (let v = 1; v <= 10; v += 1) {
			if (getDataCapacityBytes(v, 'L') >= byteLength) {
				return { version: v, ecLevel: 'L' };
			}
		}
	}
	throw new Error('Data too long for QR Version 1-10');
}

function encodeDataCodewords(
	bytes: Uint8Array,
	version: number,
	ecLevel: QrErrorCorrectionLevel
): Uint8Array {
	const spec = VERSION_SPECS[version]!;
	const ecInfo = spec.ec[ecLevel];
	const totalDataCodewords = spec.totalCodewords - ecInfo.ecPerBlock * ecInfo.numBlocks;
	const bits: number[] = [];

	// Byte mode indicator (0100)
	appendBits(0b0100, 4, bits);
	appendBits(bytes.length, version <= 9 ? 8 : 16, bits);
	for (const b of bytes) {
		appendBits(b, 8, bits);
	}

	// Terminator (up to 4 zero bits)
	const capacityBits = totalDataCodewords * 8;
	appendBits(0, Math.min(4, capacityBits - bits.length), bits);

	// Pad to byte boundary
	appendBits(0, (8 - (bits.length % 8)) % 8, bits);

	// Pad bytes (0xEC, 0x11 alternating)
	let padToggle = 0;
	while (bits.length < capacityBits) {
		appendBits(padToggle === 0 ? 0xec : 0x11, 8, bits);
		padToggle ^= 1;
	}

	const codewords = new Uint8Array(totalDataCodewords);
	for (let i = 0; i < bits.length; i += 1) {
		const idx = i >>> 3;
		codewords[idx] = (codewords[idx] ?? 0) | ((bits[i] ?? 0) << (7 - (i & 7)));
	}
	return codewords;
}

function addErrorCorrectionAndInterleave(
	data: Uint8Array,
	version: number,
	ecLevel: QrErrorCorrectionLevel
): Uint8Array {
	const spec = VERSION_SPECS[version]!;
	const { ecPerBlock, numBlocks } = spec.ec[ecLevel];
	const totalCodewords = spec.totalCodewords;

	const numShortBlocks = numBlocks - (totalCodewords % numBlocks);
	const shortBlockTotalLen = Math.floor(totalCodewords / numBlocks);
	const shortDataLen = shortBlockTotalLen - ecPerBlock;

	const divisor = rsComputeDivisor(ecPerBlock);
	const dataBlocks: Uint8Array[] = [];
	const ecBlocks: Uint8Array[] = [];

	let offset = 0;
	for (let i = 0; i < numBlocks; i += 1) {
		const dataLen = shortDataLen + (i < numShortBlocks ? 0 : 1);
		const blockData = data.subarray(offset, offset + dataLen);
		offset += dataLen;
		dataBlocks.push(blockData);
		ecBlocks.push(rsComputeRemainder(blockData, divisor));
	}

	const result = new Uint8Array(totalCodewords);
	let outIdx = 0;
	const maxDataLen = shortDataLen + 1;
	for (let col = 0; col < maxDataLen; col += 1) {
		for (let row = 0; row < numBlocks; row += 1) {
			if (col < dataBlocks[row]!.length) {
				result[outIdx] = dataBlocks[row]![col]!;
				outIdx += 1;
			}
		}
	}
	for (let col = 0; col < ecPerBlock; col += 1) {
		for (let row = 0; row < numBlocks; row += 1) {
			result[outIdx] = ecBlocks[row]![col]!;
			outIdx += 1;
		}
	}
	return result;
}

function buildFunctionTemplate(version: number): {
	modules: boolean[][];
	isFunction: boolean[][];
} {
	const size = version * 4 + 17;
	const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
	const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

	function setFunctionModule(row: number, col: number, isDark: boolean): void {
		if (row < 0 || row >= size || col < 0 || col >= size) return;
		modules[row]![col] = isDark;
		isFunction[row]![col] = true;
	}

	// Timing patterns
	for (let i = 0; i < size; i += 1) {
		setFunctionModule(6, i, i % 2 === 0);
		setFunctionModule(i, 6, i % 2 === 0);
	}

	// Finder patterns + separators (top-left, top-right, bottom-left)
	const finderOrigins: [number, number][] = [
		[0, 0],
		[0, size - 7],
		[size - 7, 0]
	];
	for (const [r0, c0] of finderOrigins) {
		for (let dr = -1; dr <= 7; dr += 1) {
			for (let dc = -1; dc <= 7; dc += 1) {
				const r = r0 + dr;
				const c = c0 + dc;
				if (r < 0 || r >= size || c < 0 || c >= size) continue;
				const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
				const onOuterRing = dr === 0 || dr === 6 || dc === 0 || dc === 6;
				const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
				setFunctionModule(r, c, inOuter && (onOuterRing || inCenter));
			}
		}
	}

	// Alignment patterns
	const coords = VERSION_SPECS[version]!.alignmentCoords;
	for (let i = 0; i < coords.length; i += 1) {
		for (let j = 0; j < coords.length; j += 1) {
			// Skip the 3 finder corners
			if (
				(i === 0 && j === 0) ||
				(i === 0 && j === coords.length - 1) ||
				(i === coords.length - 1 && j === 0)
			) {
				continue;
			}
			const cr = coords[i]!;
			const cc = coords[j]!;
			for (let dr = -2; dr <= 2; dr += 1) {
				for (let dc = -2; dc <= 2; dc += 1) {
					const dist = Math.max(Math.abs(dr), Math.abs(dc));
					setFunctionModule(cr + dr, cc + dc, dist !== 1);
				}
			}
		}
	}

	// Reserve Format Info & Dark Module
	for (let i = 0; i <= 8; i += 1) {
		if (i !== 6) {
			isFunction[8]![i] = true;
			isFunction[i]![8] = true;
		}
	}
	for (let i = 0; i < 8; i += 1) {
		isFunction[8]![size - 1 - i] = true;
	}
	for (let i = 0; i < 7; i += 1) {
		isFunction[size - 1 - i]![8] = true;
	}
	setFunctionModule(size - 8, 8, true); // Dark module

	// Version info for Version >= 7
	if (version >= 7) {
		let rem = version;
		for (let i = 0; i < 12; i += 1) {
			rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
		}
		const vBits = (version << 12) | rem;
		for (let i = 0; i < 18; i += 1) {
			const bit = ((vBits >>> i) & 1) === 1;
			const a = size - 11 + (i % 3);
			const b = Math.floor(i / 3);
			setFunctionModule(a, b, bit);
			setFunctionModule(b, a, bit);
		}
	}

	return { modules, isFunction };
}

function drawCodewords(modules: boolean[][], isFunction: boolean[][], codewords: Uint8Array): void {
	const size = modules.length;
	let bitIdx = 0;
	const totalBits = codewords.length * 8;

	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let vert = 0; vert < size; vert += 1) {
			for (let j = 0; j < 2; j += 1) {
				const col = right - j;
				const upward = ((right + 1) & 2) === 0;
				const row = upward ? size - 1 - vert : vert;
				if (!isFunction[row]![col] && bitIdx < totalBits) {
					const bit = ((codewords[bitIdx >>> 3]! >>> (7 - (bitIdx & 7))) & 1) === 1;
					modules[row]![col] = bit;
					bitIdx += 1;
				}
			}
		}
	}
}

function drawFormatBits(modules: boolean[][], ecLevel: QrErrorCorrectionLevel, mask: number): void {
	const size = modules.length;
	const ecBits = ecLevel === 'L' ? 0b01 : 0b00;
	const data = (ecBits << 3) | mask;
	let rem = data;
	for (let i = 0; i < 10; i += 1) {
		rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
	}
	const bits = ((data << 10) | rem) ^ 0x5412;
	const getBit = (idx: number) => ((bits >>> idx) & 1) === 1;

	// Copy 1: top-left
	for (let i = 0; i <= 5; i += 1) modules[i]![8] = getBit(i);
	modules[7]![8] = getBit(6);
	modules[8]![8] = getBit(7);
	modules[8]![7] = getBit(8);
	for (let i = 9; i < 15; i += 1) modules[8]![14 - i] = getBit(i);

	// Copy 2: top-right & bottom-left
	for (let i = 0; i < 8; i += 1) modules[8]![size - 1 - i] = getBit(i);
	for (let i = 8; i < 15; i += 1) modules[size - 15 + i]![8] = getBit(i);
	modules[size - 8]![8] = true;
}

function maskCondition(mask: number, row: number, col: number): boolean {
	switch (mask) {
		case 0:
			return (row + col) % 2 === 0;
		case 1:
			return row % 2 === 0;
		case 2:
			return col % 3 === 0;
		case 3:
			return (row + col) % 3 === 0;
		case 4:
			return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
		case 5:
			return ((row * col) % 2) + ((row * col) % 3) === 0;
		case 6:
			return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
		default:
			return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
	}
}

function computePenaltyScore(modules: boolean[][]): number {
	const size = modules.length;
	let penalty = 0;

	// Rule 1: 5+ consecutive same-color modules in row/col
	for (let r = 0; r < size; r += 1) {
		let runColor = modules[r]![0];
		let runLen = 1;
		for (let c = 1; c < size; c += 1) {
			if (modules[r]![c] === runColor) {
				runLen += 1;
				if (runLen === 5) penalty += 3;
				else if (runLen > 5) penalty += 1;
			} else {
				runColor = modules[r]![c];
				runLen = 1;
			}
		}
	}
	for (let c = 0; c < size; c += 1) {
		let runColor = modules[0]![c];
		let runLen = 1;
		for (let r = 1; r < size; r += 1) {
			if (modules[r]![c] === runColor) {
				runLen += 1;
				if (runLen === 5) penalty += 3;
				else if (runLen > 5) penalty += 1;
			} else {
				runColor = modules[r]![c];
				runLen = 1;
			}
		}
	}

	// Rule 2: 2x2 blocks of same color
	for (let r = 0; r < size - 1; r += 1) {
		for (let c = 0; c < size - 1; c += 1) {
			const color = modules[r]![c];
			if (
				color === modules[r]![c + 1] &&
				color === modules[r + 1]![c] &&
				color === modules[r + 1]![c + 1]
			) {
				penalty += 3;
			}
		}
	}

	// Rule 4: balance of dark vs light modules
	let darkCount = 0;
	for (let r = 0; r < size; r += 1) {
		for (let c = 0; c < size; c += 1) {
			if (modules[r]![c]) darkCount += 1;
		}
	}
	const total = size * size;
	const k = Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1;
	if (k > 0) penalty += k * 10;

	return penalty;
}

export function encodeQrCodeMatrix(
	text: string,
	preferredEc: QrErrorCorrectionLevel = 'M'
): QrCodeMatrix {
	const bytes = new TextEncoder().encode(text);
	const { version, ecLevel } = selectVersionAndEc(bytes.length, preferredEc);
	const dataCodewords = encodeDataCodewords(bytes, version, ecLevel);
	const allCodewords = addErrorCorrectionAndInterleave(dataCodewords, version, ecLevel);

	const { modules: baseModules, isFunction } = buildFunctionTemplate(version);
	drawCodewords(baseModules, isFunction, allCodewords);

	const size = baseModules.length;
	let bestMask = 0;
	let bestScore = Number.POSITIVE_INFINITY;
	let bestModules: boolean[][] = baseModules;

	for (let mask = 0; mask < 8; mask += 1) {
		const candidate = baseModules.map((row, r) =>
			row.map((val, c) => (isFunction[r]![c] ? val : val !== maskCondition(mask, r, c)))
		);
		drawFormatBits(candidate, ecLevel, mask);
		const score = computePenaltyScore(candidate);
		if (score < bestScore) {
			bestScore = score;
			bestMask = mask;
			bestModules = candidate;
		}
	}

	drawFormatBits(bestModules, ecLevel, bestMask);
	return {
		version,
		size,
		modules: bestModules
	};
}

export interface QrSvgOptions {
	margin?: number;
	darkColor?: string;
	lightColor?: string;
	ecLevel?: QrErrorCorrectionLevel;
}

export function renderQrCodeSvgData(
	text: string,
	options: QrSvgOptions = {}
): {
	viewBoxSize: number;
	pathData: string;
	svgMarkup: string;
	version: number;
} {
	const margin = options.margin ?? 4;
	const darkColor = options.darkColor ?? '#111827';
	const lightColor = options.lightColor ?? '#ffffff';
	const matrix = encodeQrCodeMatrix(text, options.ecLevel ?? 'M');
	const viewBoxSize = matrix.size + margin * 2;

	const parts: string[] = [];
	for (let r = 0; r < matrix.size; r += 1) {
		for (let c = 0; c < matrix.size; c += 1) {
			if (matrix.modules[r]![c]) {
				const x = c + margin;
				const y = r + margin;
				parts.push(`M${x} ${y}h1v1h-1z`);
			}
		}
	}
	const pathData = parts.join('');
	const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" shape-rendering="crispEdges"><rect width="${viewBoxSize}" height="${viewBoxSize}" fill="${lightColor}"/><path d="${pathData}" fill="${darkColor}"/></svg>`;

	return {
		viewBoxSize,
		pathData,
		svgMarkup,
		version: matrix.version
	};
}
