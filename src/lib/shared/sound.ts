/**
 * Plays the custom countdown sound effect (/sounds/countdown.mp3).
 */

const COUNTDOWN_AUDIO_URL = '/sounds/countdown.mp3';
const CROSS_TAB_TICK_KEY = 'quizky_clock_last_tick';

let sharedContext: AudioContext | null = null;
let decodedBuffer: AudioBuffer | null = null;
let loadingPromise: Promise<AudioBuffer | null> | null = null;
let activeSource: AudioBufferSourceNode | null = null;

function getAudioContext(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	if (!sharedContext) {
		const AudioCtx =
			window.AudioContext ||
			(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!AudioCtx) return null;
		sharedContext = new AudioCtx();
	}
	return sharedContext;
}

async function loadCountdownBuffer(ctx: AudioContext): Promise<AudioBuffer | null> {
	if (decodedBuffer) return decodedBuffer;
	if (loadingPromise) return loadingPromise;

	loadingPromise = fetch(COUNTDOWN_AUDIO_URL)
		.then((res) => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.arrayBuffer();
		})
		.then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer))
		.then((buffer) => {
			decodedBuffer = buffer;
			return buffer;
		})
		.catch(() => {
			loadingPromise = null;
			return null;
		});

	return loadingPromise;
}

export function unlockAudioContext(): void {
	const ctx = getAudioContext();
	if (!ctx) return;
	if (ctx.state === 'suspended') {
		void ctx.resume().catch(() => {
			// Ignore until user gesture.
		});
	}
	void loadCountdownBuffer(ctx);
}

export function stopCountdownSound(): void {
	if (activeSource) {
		try {
			activeSource.stop();
		} catch {
			// Ignore if already stopped.
		}
		activeSource = null;
	}
}

function playSlice(offsetSeconds: number, durationSeconds?: number): void {
	const ctx = getAudioContext();
	if (!ctx) return;

	const startPlayback = (buffer: AudioBuffer) => {
		stopCountdownSound();
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(ctx.destination);
		activeSource = source;
		source.addEventListener('ended', () => {
			if (activeSource === source) {
				activeSource = null;
			}
		});
		if (durationSeconds !== undefined) {
			source.start(0, offsetSeconds, durationSeconds);
		} else {
			source.start(0, offsetSeconds);
		}
	};

	const run = () => {
		if (decodedBuffer) {
			startPlayback(decodedBuffer);
		} else {
			void loadCountdownBuffer(ctx).then((buffer) => {
				if (buffer) startPlayback(buffer);
				return undefined;
			});
		}
	};

	if (ctx.state === 'running') {
		run();
	} else {
		void ctx
			.resume()
			.then(() => {
				if (ctx.state === 'running') {
					run();
				}
				return undefined;
			})
			.catch(() => {
				// Ignore autoplay restriction errors.
			});
	}
}

/**
 * Plays the countdown sound effect synchronized to the remaining seconds.
 * /sounds/countdown.mp3 has 4 beats at 0.0s, 1.0s, 2.0s, and 3.0s (total 3.55s).
 */
export function playCountdownTick(secondsLeft: number): void {
	// The MP3 is a 4-beat countdown (4s, 3s, 2s, 1s)
	if (secondsLeft < 1 || secondsLeft > 4) return;

	const nowEpoch = Date.now();
	try {
		const raw = localStorage.getItem(CROSS_TAB_TICK_KEY);
		if (raw) {
			const [prevSecStr, prevTimeStr] = raw.split(':');
			const prevSec = Number(prevSecStr);
			const prevTime = Number(prevTimeStr);
			if ((prevSec === secondsLeft && nowEpoch - prevTime < 900) || nowEpoch - prevTime < 700) {
				return;
			}
		}
		localStorage.setItem(CROSS_TAB_TICK_KEY, `${secondsLeft}:${nowEpoch}`);
	} catch {
		// Ignore storage access errors in private browsing modes.
	}

	// Map 4s -> 0.0s beat, 3s -> 1.0s beat, 2s -> 2.0s beat, 1s -> 3.0s final beat
	const beatIndex = 4 - secondsLeft;
	const offset = beatIndex * 1.0;
	const duration = secondsLeft === 1 ? 0.55 : 0.45;
	playSlice(offset, duration);
}

/**
 * Plays the full /sounds/countdown.mp3 effect when toggling sound on.
 */
export function playClockPreview(): void {
	playSlice(0);
}

/**
 * Stops any remaining countdown audio when the question ends early.
 */
export function playTimeUpSound(): void {
	stopCountdownSound();
}
