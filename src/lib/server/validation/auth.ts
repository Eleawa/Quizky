import { z } from 'zod';

const encoder = new TextEncoder();
const MAX_PASSWORD_UTF8_BYTES = 512;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const passwordSchema = z
	.string()
	.min(10, 'Use at least 10 characters.')
	.max(128, 'Use at most 128 characters.')
	.refine((val) => encoder.encode(val).byteLength <= MAX_PASSWORD_UTF8_BYTES, {
		message: 'Use at most 128 characters.'
	});

export const displayNameSchema = z
	.string()
	.trim()
	.min(2, 'Use at least 2 characters.')
	.max(80, 'Use at most 80 characters.');

export const registerSchema = z
	.object({
		email: emailSchema,
		password: passwordSchema,
		displayName: displayNameSchema
	})
	.strict();

export const loginSchema = z
	.object({
		email: emailSchema,
		password: z
			.string()
			.min(1, 'Enter your password.')
			.max(128)
			.refine((val) => encoder.encode(val).byteLength <= MAX_PASSWORD_UTF8_BYTES, {
				message: 'Use at most 128 characters.'
			})
	})
	.strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
	const fields: Record<string, string> = {};
	for (const issue of error.issues) {
		const path = issue.path.map(String).join('.');
		if (path.length > 0 && !(path in fields)) {
			fields[path] = issue.message;
		}
		const key = issue.path[0];
		if (typeof key === 'string' && !(key in fields)) {
			fields[key] = issue.message;
		}
	}
	return fields;
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		if (value.charCodeAt(index) <= 0x1f) return true;
	}
	return false;
}

export function safeNextPath(value: string | null): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/api/')) {
		return '/dashboard';
	}
	if (value.includes('\\') || hasControlCharacter(value)) {
		return '/dashboard';
	}
	return value;
}
