import { ApiError } from '#lib/server/api/errors.js';
import { resolvePlatformEnv } from '#lib/server/db/client.js';
import {
	QUIZ_LIMITS,
	quizQuestionInputSchema,
	type GenerateQuizQuestionsInput,
	type ValidatedQuestionInput
} from '#lib/server/validation/quiz.js';

interface AiBinding {
	run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

interface RawAiQuestion {
	text?: unknown;
	question?: unknown;
	options?: unknown;
	choices?: unknown;
	correctIndex?: unknown;
	answerIndex?: unknown;
	correctOption?: unknown;
}

const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function sanitizeJsonControlChars(input: string): string {
	let out = '';
	let inString = false;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i]!;
		if (inString) {
			if (ch === '\\') {
				out += ch;
				if (i + 1 < input.length) {
					out += input[i + 1]!;
					i++;
				}
				continue;
			}
			if (ch === '"') {
				inString = false;
				out += ch;
				continue;
			}
			if (ch === '\n') {
				out += '\\n';
				continue;
			}
			if (ch === '\r') {
				continue;
			}
			if (ch === '\t') {
				out += '\\t';
				continue;
			}
			out += ch;
		} else {
			if (ch === '"') {
				inString = true;
			}
			out += ch;
		}
	}
	return out;
}

function extractJsonArray(rawText: string): unknown[] {
	const trimmed = rawText.trim();

	// Strip markdown ```json ... ``` fences if present
	const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = sanitizeJsonControlChars(fenceMatch?.[1]?.trim() ?? trimmed);

	try {
		const parsed = JSON.parse(candidate) as unknown;
		if (Array.isArray(parsed)) return parsed;
		if (parsed && typeof parsed === 'object' && 'questions' in parsed) {
			const q = (parsed as { questions?: unknown }).questions;
			if (Array.isArray(q)) return q;
		}
	} catch {
		// Fall through to bracket search
	}

	const firstBracket = candidate.indexOf('[');
	const lastBracket = candidate.lastIndexOf(']');
	if (firstBracket !== -1 && lastBracket > firstBracket) {
		const slice = candidate.slice(firstBracket, lastBracket + 1);
		const parsed = JSON.parse(slice) as unknown;
		if (Array.isArray(parsed)) return parsed;
	}

	throw new Error('Could not parse JSON array from AI response.');
}

function normalizeQuestionText(rawText: string): string {
	let text = rawText
		// Convert double-escaped newlines/tabs that LLMs sometimes emit in JSON
		.replace(/\\r\\n/g, '\n')
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '  ')
		// Strip markdown code fences while keeping the code on separate lines
		.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, '\n\n$1\n')
		.trim();

	// If the model wrapped a multi-statement snippet in single backticks on one line,
	// e.g. What is the output of `int x = 1; int y = 2; print(x + y);`?
	text = text.replace(/\s*`([^`\n]*;[^`\n]*)`\s*\??$/m, (_, code: string) => {
		const lines = code
			.split(/;\s*/)
			.map((s) => s.trim())
			.filter(Boolean)
			.map((s) => (s.endsWith(';') ? s : `${s};`));
		return `\n\n${lines.join('\n')}`;
	});

	// Collapse 3+ consecutive newlines to 2
	text = text.replace(/\n{3,}/g, '\n\n').trim();

	return text.slice(0, QUIZ_LIMITS.maxQuestionTextLength);
}

function normalizeRawQuestion(
	item: unknown,
	timeLimitSeconds: number,
	points: number
): ValidatedQuestionInput | null {
	if (!item || typeof item !== 'object') return null;
	const raw = item as RawAiQuestion;

	const questionTextRaw =
		typeof raw.text === 'string' ? raw.text : typeof raw.question === 'string' ? raw.question : '';
	const text = normalizeQuestionText(questionTextRaw);
	if (!text) return null;

	const rawOptions = Array.isArray(raw.options)
		? raw.options
		: Array.isArray(raw.choices)
			? raw.choices
			: [];

	let correctIdx =
		typeof raw.correctIndex === 'number'
			? raw.correctIndex
			: typeof raw.answerIndex === 'number'
				? raw.answerIndex
				: typeof raw.correctOption === 'number'
					? raw.correctOption
					: -1;

	const options: { text: string; isCorrect: boolean }[] = [];

	for (let i = 0; i < rawOptions.length && options.length < QUIZ_LIMITS.maxOptions; i++) {
		const opt = rawOptions[i];
		if (typeof opt === 'string') {
			const optText = opt.trim().slice(0, QUIZ_LIMITS.maxOptionTextLength);
			if (optText) {
				options.push({ text: optText, isCorrect: false });
			}
		} else if (opt && typeof opt === 'object') {
			const optObj = opt as { text?: unknown; isCorrect?: unknown };
			if (typeof optObj.text === 'string') {
				const optText = optObj.text.trim().slice(0, QUIZ_LIMITS.maxOptionTextLength);
				if (optText) {
					const isCorrect = optObj.isCorrect === true;
					if (isCorrect && correctIdx === -1) {
						correctIdx = options.length;
					}
					options.push({ text: optText, isCorrect: false });
				}
			}
		}
	}

	if (options.length < QUIZ_LIMITS.minOptions) return null;

	const safeCorrectIdx =
		correctIdx >= 0 && correctIdx < options.length ? Math.floor(correctIdx) : 0;
	const targetOpt = options[safeCorrectIdx];
	if (targetOpt) {
		targetOpt.isCorrect = true;
	}

	const parsed = quizQuestionInputSchema.safeParse({
		text,
		imageUrl: null,
		timeLimitSeconds,
		points,
		options
	});

	return parsed.success ? parsed.data : null;
}

export async function generateQuestionsWithAi(
	platform: App.Platform | undefined,
	input: GenerateQuizQuestionsInput
): Promise<ValidatedQuestionInput[]> {
	const env = resolvePlatformEnv(platform) as { AI?: AiBinding } | undefined;
	const ai = env?.AI;
	if (!ai) {
		throw new ApiError(
			503,
			'AI_UNAVAILABLE',
			'Cloudflare Workers AI binding (AI) is not available in this environment.'
		);
	}

	const systemPrompt = [
		'You are an expert classroom quiz creator.',
		'Respond ONLY with a valid JSON array of multiple-choice questions. Do not include any markdown, explanations, or commentary outside the JSON array.',
		'Each object in the JSON array must have:',
		`- "text": string (the question prompt, max ${QUIZ_LIMITS.maxQuestionTextLength} characters, clear and self-contained)`,
		'- "options": array of exactly 4 distinct answer strings (each max 120 characters)',
		'- "correctIndex": integer from 0 to 3 indicating which option in "options" is the single correct answer (vary the correctIndex across questions).',
		'CRITICAL FORMATTING RULE FOR CODE SNIPPETS & MULTILINE PROMPTS:',
		'- Whenever a question includes a code snippet, program, terminal command, or multi-step expression, you MUST format it across multiple lines using "\\n" line breaks and 2-space indentation.',
		'- NEVER cram multiple lines or statements of code onto a single line.',
		'- Separate the question sentence from the code snippet with a blank line ("\\n\\n").',
		'- Example of a properly formatted code question "text" value in JSON:',
		'  "What is the output of the following code?\\n\\nx = [1, 2, 3]\\nfor n in x:\\n  print(n * 2)"'
	].join('\n');

	const userPrompt = [
		`Create exactly ${input.count} ${input.difficulty}-difficulty multiple-choice questions based on the following topic or source material:`,
		'',
		input.prompt,
		'',
		'If any question includes a code snippet, put each statement on its own line using "\\n" (never put multiple lines of code on one line, and do not use markdown backticks).',
		`Return ONLY a raw JSON array of ${input.count} question objects.`
	].join('\n');

	let rawResult: unknown;
	try {
		rawResult = await ai.run(AI_MODEL, {
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			],
			max_tokens: 2048,
			temperature: 0.4
		});
	} catch (err) {
		const detail = err instanceof Error ? err.message : 'Workers AI request failed';
		throw new ApiError(
			502,
			'AI_GENERATION_FAILED',
			`Could not generate questions with Workers AI (${detail}).`
		);
	}

	let rawArray: unknown[];
	try {
		if (Array.isArray(rawResult)) {
			rawArray = rawResult;
		} else if (rawResult && typeof rawResult === 'object') {
			const resObj = rawResult as {
				response?: unknown;
				questions?: unknown;
				choices?: Array<{ message?: { content?: unknown } }>;
			};
			const choiceContent = resObj.choices?.[0]?.message?.content;
			if (Array.isArray(resObj.questions)) {
				rawArray = resObj.questions;
			} else if (Array.isArray(resObj.response)) {
				rawArray = resObj.response;
			} else if (typeof resObj.response === 'string') {
				rawArray = extractJsonArray(resObj.response);
			} else if (typeof choiceContent === 'string') {
				rawArray = extractJsonArray(choiceContent);
			} else if (resObj.response && typeof resObj.response === 'object') {
				const nested = (resObj.response as { questions?: unknown }).questions;
				if (Array.isArray(nested)) {
					rawArray = nested;
				} else {
					rawArray = extractJsonArray(JSON.stringify(resObj.response));
				}
			} else {
				rawArray = extractJsonArray(JSON.stringify(rawResult));
			}
		} else if (typeof rawResult === 'string') {
			rawArray = extractJsonArray(rawResult);
		} else {
			throw new Error('Unexpected AI output format');
		}
	} catch {
		throw new ApiError(
			502,
			'AI_PARSE_ERROR',
			'The AI returned an invalid format. Try rephrasing your prompt or generating fewer questions.'
		);
	}

	const questions: ValidatedQuestionInput[] = [];
	for (const item of rawArray) {
		if (questions.length >= input.count) break;
		const normalized = normalizeRawQuestion(item, input.timeLimitSeconds, input.points);
		if (normalized) {
			questions.push(normalized);
		}
	}

	if (questions.length === 0) {
		throw new ApiError(
			502,
			'AI_EMPTY_RESULT',
			'Could not extract valid multiple-choice questions from the AI response. Please try again.'
		);
	}

	return questions;
}
