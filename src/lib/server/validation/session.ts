import { z } from 'zod';
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, NICKNAME_LIMITS } from '#lib/shared/session.js';

export function normalizeJoinCode(value: string): string {
	return value.trim().toUpperCase();
}

export function generateJoinCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(JOIN_CODE_LENGTH));
	let code = '';
	for (const byte of bytes) {
		code += JOIN_CODE_ALPHABET[byte & 31] ?? '2';
	}
	return code;
}

export function collapseWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

export function normalizeNickname(value: string): string {
	return collapseWhitespace(value).toLowerCase();
}

function hasInvalidNicknameCharacters(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f || value[index] === '<' || value[index] === '>') {
			return true;
		}
	}
	return false;
}

export const joinCodeSchema = z
	.string()
	.transform(normalizeJoinCode)
	.pipe(
		z
			.string()
			.regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/, 'Enter a valid 6-character join code.')
	);

export const nicknameSchema = z
	.string()
	.transform(collapseWhitespace)
	.pipe(
		z
			.string()
			.min(NICKNAME_LIMITS.minLength, `Use at least ${NICKNAME_LIMITS.minLength} characters.`)
			.max(NICKNAME_LIMITS.maxLength, `Use at most ${NICKNAME_LIMITS.maxLength} characters.`)
			.refine(
				(value) => !hasInvalidNicknameCharacters(value),
				'Nickname contains unsupported characters.'
			)
	);

export const joinSessionRequestSchema = z
	.object({
		nickname: nicknameSchema,
		participantToken: z.string().trim().min(1).max(512).optional()
	})
	.strict();

export type JoinSessionRequestInput = z.infer<typeof joinSessionRequestSchema>;
