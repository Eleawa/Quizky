import { describe, expect, it } from 'vitest';
import { generateQuestionsWithAi } from '#lib/server/quizzes/ai-generator.js';
import { generateQuizQuestionsSchema } from '#lib/server/validation/quiz.js';
import { parseQuestionSegments } from '#lib/shared/code-highlight.js';

describe('AI Quiz Question Generator', () => {
	it('validates generation input with defaults', () => {
		const parsed = generateQuizQuestionsSchema.parse({
			prompt: 'Photosynthesis for 8th grade biology'
		});
		expect(parsed.count).toBe(5);
		expect(parsed.difficulty).toBe('medium');
		expect(parsed.timeLimitSeconds).toBe(20);
		expect(parsed.points).toBe(100);
	});

	it('parses markdown-fenced JSON arrays from Cloudflare Workers AI and normalizes options', async () => {
		const mockPlatform = {
			env: {
				AI: {
					run: async () => ({
						response: [
							'```json',
							JSON.stringify([
								{
									text: 'What organelle is responsible for photosynthesis in plant cells?',
									options: ['Mitochondria', 'Chloroplast', 'Ribosome', 'Nucleus'],
									correctIndex: 1
								},
								{
									question: 'Which gas is absorbed by plants during photosynthesis?',
									choices: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'],
									answerIndex: 2
								}
							]),
							'```'
						].join('\n')
					})
				}
			}
		} as unknown as App.Platform;

		const questions = await generateQuestionsWithAi(mockPlatform, {
			prompt: 'Photosynthesis',
			count: 2,
			difficulty: 'medium',
			timeLimitSeconds: 25,
			points: 150
		});

		expect(questions).toHaveLength(2);
		expect(questions[0]?.text).toContain('organelle');
		expect(questions[0]?.timeLimitSeconds).toBe(25);
		expect(questions[0]?.points).toBe(150);
		expect(questions[0]?.options.map((o) => o.isCorrect)).toEqual([false, true, false, false]);
		expect(questions[1]?.options.map((o) => o.isCorrect)).toEqual([false, false, true, false]);
	});

	it('preserves multiline code snippets and normalizes escaped or fenced code blocks', async () => {
		const mockPlatform = {
			env: {
				AI: {
					run: async () => ({
						response: JSON.stringify([
							{
								text: 'What is the output of this Python snippet?\\n\\nx = [1, 2, 3]\\nfor n in x:\\n  print(n * 2)',
								options: ['2 4 6', '1 2 3', 'Error', 'None'],
								correctIndex: 0
							},
							{
								text: 'What does this print? `int a = 2; int b = 3; printf("%d", a + b);`',
								options: ['23', '5', '6', '0'],
								correctIndex: 1
							}
						])
					})
				}
			}
		} as unknown as App.Platform;

		const questions = await generateQuestionsWithAi(mockPlatform, {
			prompt: 'Generate code snippets and ask for output',
			count: 2,
			difficulty: 'medium',
			timeLimitSeconds: 30,
			points: 100
		});

		expect(questions).toHaveLength(2);
		expect(questions[0]?.text).toBe(
			'What is the output of this Python snippet?\n\nx = [1, 2, 3]\nfor n in x:\n  print(n * 2)'
		);
		expect(questions[1]?.text).toBe(
			'What does this print?\n\nint a = 2;\nint b = 3;\nprintf("%d", a + b);'
		);

		const segments = parseQuestionSegments(questions[0]!.text);
		expect(segments).toHaveLength(2);
		expect(segments[0]).toEqual({
			type: 'text',
			content: 'What is the output of this Python snippet?'
		});
		expect(segments[1]?.type).toBe('code');
		expect(segments[1]?.language).toBe('python');
		expect(segments[1]?.highlightedHtml).toContain('hljs-keyword');

		const cSegments = parseQuestionSegments(questions[1]!.text);
		expect(cSegments).toHaveLength(2);
		expect(cSegments[1]?.type).toBe('code');
		expect(cSegments[1]?.language).toBe('c');

		const singleNewlineJs = parseQuestionSegments(
			'What is the output of the following code?\nconst nums = [1, 2, 3];\nconsole.log(nums.length);'
		);
		expect(singleNewlineJs[1]?.language).toBe('javascript');
	});

	it('throws AI_UNAVAILABLE when platform.env.AI binding is missing', async () => {
		await expect(
			generateQuestionsWithAi({ env: {} } as unknown as App.Platform, {
				prompt: 'World history',
				count: 3,
				difficulty: 'easy',
				timeLimitSeconds: 20,
				points: 100
			})
		).rejects.toMatchObject({
			status: 503,
			code: 'AI_UNAVAILABLE'
		});
	});
});
