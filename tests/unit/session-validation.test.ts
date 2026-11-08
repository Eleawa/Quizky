import { describe, expect, it } from 'vitest';
import {
	generateJoinCode,
	joinCodeSchema,
	joinSessionRequestSchema,
	nicknameSchema,
	normalizeJoinCode,
	normalizeNickname
} from '../../src/lib/server/validation/session.js';
import { parseClientMessage } from '../../src/lib/game/protocol/messages.js';

describe('join code generation and validation', () => {
	it('generates 6-character unambiguous uppercase codes', () => {
		for (let i = 0; i < 50; i += 1) {
			const code = generateJoinCode();
			expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
			expect(joinCodeSchema.parse(code)).toBe(code);
		}
	});

	it('normalizes lowercase and whitespace around join codes', () => {
		expect(normalizeJoinCode('  ab23cd  ')).toBe('AB23CD');
		expect(joinCodeSchema.parse(' ab23cd ')).toBe('AB23CD');
	});

	it('rejects ambiguous or wrong-length join codes', () => {
		expect(joinCodeSchema.safeParse('ABC123').success).toBe(false); // 1 is ambiguous
		expect(joinCodeSchema.safeParse('ABCO23').success).toBe(false); // O is ambiguous
		expect(joinCodeSchema.safeParse('ABC023').success).toBe(false); // 0 is ambiguous
		expect(joinCodeSchema.safeParse('ABCI23').success).toBe(false); // I is ambiguous
		expect(joinCodeSchema.safeParse('AB23C').success).toBe(false); // 5 chars
		expect(joinCodeSchema.safeParse('AB23CDE').success).toBe(false); // 7 chars
	});
});

describe('nickname normalization and validation', () => {
	it('collapses internal whitespace and trims ends', () => {
		expect(nicknameSchema.parse('  Ada   Lovelace  ')).toBe('Ada Lovelace');
		expect(normalizeNickname('  Ada   Lovelace  ')).toBe('ada lovelace');
	});

	it('rejects too-short, too-long, or unsafe nicknames', () => {
		expect(nicknameSchema.safeParse('A').success).toBe(false);
		expect(nicknameSchema.safeParse('   ').success).toBe(false);
		expect(nicknameSchema.safeParse('x'.repeat(25)).success).toBe(false);
		expect(nicknameSchema.safeParse('Ada <script>').success).toBe(false);
		expect(nicknameSchema.safeParse('Ada\u0000').success).toBe(false);
	});

	it('validates joinSessionRequestSchema with optional participantToken', () => {
		const valid = joinSessionRequestSchema.parse({
			nickname: '  Grace  Hopper ',
			participantToken: 'token-123'
		});
		expect(valid).toEqual({
			nickname: 'Grace Hopper',
			participantToken: 'token-123'
		});
	});
});

describe('WebSocket client protocol message validation', () => {
	it('accepts valid client messages', () => {
		const joinMsg = parseClientMessage(JSON.stringify({ version: 1, type: 'join_session' }));
		expect(joinMsg).toEqual({
			ok: true,
			message: { version: 1, type: 'join_session' }
		});

		const answerMsg = parseClientMessage(
			JSON.stringify({
				version: 1,
				type: 'submit_answer',
				questionId: 'q-1',
				optionId: 'opt-2',
				requestId: 'req-1'
			})
		);
		expect(answerMsg.ok).toBe(true);

		const startMsg = parseClientMessage(
			JSON.stringify({
				version: 1,
				type: 'teacher_start_game',
				requestId: 'req-start'
			})
		);
		expect(startMsg.ok).toBe(true);

		const skipMsg = parseClientMessage(
			JSON.stringify({
				version: 1,
				type: 'teacher_skip_question',
				requestId: 'req-skip'
			})
		);
		expect(skipMsg.ok).toBe(true);
	});

	it('rejects malformed JSON, unknown types, and oversized payloads', () => {
		expect(parseClientMessage('')).toMatchObject({ ok: false, code: 'invalid_message' });
		expect(parseClientMessage('{not json}')).toMatchObject({
			ok: false,
			code: 'invalid_message'
		});
		expect(parseClientMessage(JSON.stringify({ version: 1, type: 'unknown_event' }))).toMatchObject(
			{
				ok: false,
				code: 'invalid_message'
			}
		);
		expect(parseClientMessage('a'.repeat(5000))).toMatchObject({
			ok: false,
			code: 'invalid_message'
		});
	});
});
