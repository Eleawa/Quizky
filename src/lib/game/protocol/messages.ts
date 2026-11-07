import { z } from 'zod';
import {
	PROTOCOL_VERSION,
	type GameSummary,
	type PublicParticipant,
	type PublicQuestion,
	type QuestionResultForRole,
	type RoomSnapshot,
	type TeacherLeaderboard
} from '../../shared/session.js';

const requestIdSchema = z.string().trim().min(1).max(64);
const entityIdSchema = z.string().trim().min(1).max(64);

export const clientMessageSchema = z.discriminatedUnion('type', [
	z
		.object({
			version: z.literal(PROTOCOL_VERSION).optional(),
			type: z.literal('join_session'),
			participantToken: z.string().trim().min(1).max(512).optional()
		})
		.strict(),
	z
		.object({
			version: z.literal(PROTOCOL_VERSION).optional(),
			type: z.literal('submit_answer'),
			questionId: entityIdSchema,
			optionId: entityIdSchema,
			requestId: requestIdSchema
		})
		.strict(),
	z
		.object({
			version: z.literal(PROTOCOL_VERSION).optional(),
			type: z.literal('teacher_start_game'),
			requestId: requestIdSchema
		})
		.strict(),
	z
		.object({
			version: z.literal(PROTOCOL_VERSION).optional(),
			type: z.literal('teacher_advance_question'),
			requestId: requestIdSchema
		})
		.strict(),
	z
		.object({
			version: z.literal(PROTOCOL_VERSION).optional(),
			type: z.literal('teacher_end_game'),
			requestId: requestIdSchema
		})
		.strict()
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ServerMessage =
	| { version: typeof PROTOCOL_VERSION; type: 'room_snapshot'; payload: RoomSnapshot }
	| { version: typeof PROTOCOL_VERSION; type: 'participant_joined'; payload: PublicParticipant }
	| {
			version: typeof PROTOCOL_VERSION;
			type: 'participant_left';
			payload: { participantId: string };
	  }
	| { version: typeof PROTOCOL_VERSION; type: 'game_started'; payload: { startedAt: string } }
	| { version: typeof PROTOCOL_VERSION; type: 'question_started'; payload: PublicQuestion }
	| {
			version: typeof PROTOCOL_VERSION;
			type: 'answer_received';
			payload: { answeredCount: number; participantCount: number };
	  }
	| {
			version: typeof PROTOCOL_VERSION;
			type: 'question_ended';
			payload: QuestionResultForRole;
	  }
	| {
			version: typeof PROTOCOL_VERSION;
			type: 'leaderboard_updated';
			payload: TeacherLeaderboard;
	  }
	| { version: typeof PROTOCOL_VERSION; type: 'game_completed'; payload: GameSummary }
	| {
			version: typeof PROTOCOL_VERSION;
			type: 'error';
			payload: { code: string; message: string };
	  };

const MAX_WS_MESSAGE_LENGTH = 4096;

export function parseClientMessage(
	raw: string
): { ok: true; message: ClientMessage } | { ok: false; code: string; message: string } {
	if (raw.length === 0 || raw.length > MAX_WS_MESSAGE_LENGTH) {
		return {
			ok: false,
			code: 'invalid_message',
			message: 'Message payload is empty or too large.'
		};
	}

	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(raw);
	} catch {
		return {
			ok: false,
			code: 'invalid_message',
			message: 'Message must be valid JSON.'
		};
	}

	const validated = clientMessageSchema.safeParse(parsedJson);
	if (!validated.success) {
		return {
			ok: false,
			code: 'invalid_message',
			message: 'Message does not match the Quizky protocol.'
		};
	}

	return { ok: true, message: validated.data };
}
