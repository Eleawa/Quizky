import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '../db/client.js';
import {
	gameSessions,
	participantAnswers,
	participants,
	sessionQuestionOptions,
	sessionQuestions,
	type GameSessionRow,
	type NewGameSessionRow,
	type NewParticipantAnswerRow,
	type NewParticipantRow,
	type NewSessionQuestionOptionRow,
	type NewSessionQuestionRow,
	type ParticipantAnswerRow,
	type ParticipantRow,
	type ParticipantStatus,
	type SessionQuestionOptionRow
} from '../db/schema.js';
import type { RoomExportPayload } from './room-client.js';
import type { PublicParticipant, SessionSnapshotQuestion } from '#lib/shared/session.js';

const D1_MAX_IN_PARAMS = 80;
const D1_BATCH_CHUNK_SIZE = 100;

export interface SessionSnapshotWrite {
	question: NewSessionQuestionRow;
	options: NewSessionQuestionOptionRow[];
}

export function toPublicParticipantRow(row: ParticipantRow): PublicParticipant {
	return {
		id: row.id,
		nickname: row.nickname,
		status: row.status,
		joinedAt: row.joinedAt.toISOString()
	};
}

export async function isJoinCodeActive(db: Database, joinCode: string): Promise<boolean> {
	const [row] = await db
		.select({ id: gameSessions.id })
		.from(gameSessions)
		.where(
			and(
				eq(gameSessions.joinCode, joinCode),
				inArray(gameSessions.status, ['lobby', 'in_progress'])
			)
		)
		.limit(1);

	return Boolean(row);
}

export async function findSessionById(
	db: Database,
	sessionId: string
): Promise<GameSessionRow | null> {
	const [row] = await db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1);

	return row ?? null;
}

export async function listSessionsByTeacher(
	db: Database,
	teacherId: string,
	limit: number = 12
): Promise<GameSessionRow[]> {
	return db
		.select()
		.from(gameSessions)
		.where(eq(gameSessions.teacherId, teacherId))
		.orderBy(desc(gameSessions.createdAt))
		.limit(limit);
}

export async function findSessionByJoinCode(
	db: Database,
	joinCode: string
): Promise<GameSessionRow | null> {
	const [row] = await db
		.select()
		.from(gameSessions)
		.where(eq(gameSessions.joinCode, joinCode))
		.orderBy(desc(gameSessions.createdAt))
		.limit(1);

	return row ?? null;
}

export async function insertSessionWithSnapshot(
	db: Database,
	session: NewGameSessionRow,
	snapshotWrites: SessionSnapshotWrite[]
): Promise<void> {
	const statements: BatchItem<'sqlite'>[] = [db.insert(gameSessions).values(session)];

	for (const item of snapshotWrites) {
		statements.push(db.insert(sessionQuestions).values(item.question));
		if (item.options.length > 0) {
			statements.push(db.insert(sessionQuestionOptions).values(item.options));
		}
	}

	for (let i = 0; i < statements.length; i += D1_BATCH_CHUNK_SIZE) {
		const [first, ...rest] = statements.slice(i, i + D1_BATCH_CHUNK_SIZE);
		if (first) {
			await db.batch([first, ...rest]);
		}
	}
}

export async function getSessionSnapshotQuestions(
	db: Database,
	sessionId: string
): Promise<SessionSnapshotQuestion[]> {
	const questionRows = await db
		.select()
		.from(sessionQuestions)
		.where(eq(sessionQuestions.sessionId, sessionId))
		.orderBy(asc(sessionQuestions.position));

	const questionIds = questionRows.map((row) => row.id);
	const optionRows =
		questionIds.length > 0
			? await db
					.select()
					.from(sessionQuestionOptions)
					.where(inArray(sessionQuestionOptions.sessionQuestionId, questionIds))
					.orderBy(asc(sessionQuestionOptions.position))
			: [];

	const optionsByQuestion = new Map<string, SessionQuestionOptionRow[]>();
	for (const option of optionRows) {
		const bucket = optionsByQuestion.get(option.sessionQuestionId);
		if (bucket) {
			bucket.push(option);
		} else {
			optionsByQuestion.set(option.sessionQuestionId, [option]);
		}
	}

	return questionRows.map((question) => ({
		id: question.id,
		sourceQuestionId: question.sourceQuestionId,
		text: question.text,
		imageUrl: question.imageUrl ?? null,
		position: question.position,
		timeLimitSeconds: question.timeLimitSeconds,
		points: question.points,
		options: (optionsByQuestion.get(question.id) ?? []).map((option) => ({
			id: option.id,
			text: option.text,
			position: option.position,
			isCorrect: option.isCorrect
		}))
	}));
}

export async function countSessionQuestions(db: Database, sessionId: string): Promise<number> {
	const [row] = await db
		.select({ total: count(sessionQuestions.id) })
		.from(sessionQuestions)
		.where(eq(sessionQuestions.sessionId, sessionId));

	return Number(row?.total ?? 0);
}

export async function countSessionParticipants(db: Database, sessionId: string): Promise<number> {
	const [row] = await db
		.select({ total: count(participants.id) })
		.from(participants)
		.where(eq(participants.sessionId, sessionId));

	return Number(row?.total ?? 0);
}

export async function listSessionParticipants(
	db: Database,
	sessionId: string
): Promise<ParticipantRow[]> {
	return db
		.select()
		.from(participants)
		.where(eq(participants.sessionId, sessionId))
		.orderBy(asc(participants.joinedAt), asc(participants.id));
}

export async function findParticipantByTokenHash(
	db: Database,
	sessionId: string,
	tokenHash: string
): Promise<ParticipantRow | null> {
	const [row] = await db
		.select()
		.from(participants)
		.where(
			and(eq(participants.sessionId, sessionId), eq(participants.participantTokenHash, tokenHash))
		)
		.limit(1);

	return row ?? null;
}

export async function findParticipantByNormalizedNickname(
	db: Database,
	sessionId: string,
	nicknameNormalized: string
): Promise<ParticipantRow | null> {
	const [row] = await db
		.select()
		.from(participants)
		.where(
			and(
				eq(participants.sessionId, sessionId),
				eq(participants.nicknameNormalized, nicknameNormalized)
			)
		)
		.limit(1);

	return row ?? null;
}

export async function insertParticipantRow(
	db: Database,
	values: NewParticipantRow
): Promise<ParticipantRow> {
	const [row] = await db.insert(participants).values(values).returning();
	if (!row) {
		throw new Error('Failed to insert participant');
	}
	return row;
}

export async function markParticipantConnected(
	db: Database,
	participantId: string,
	status: ParticipantStatus = 'connected',
	now: Date = new Date()
): Promise<void> {
	await db
		.update(participants)
		.set({ status, lastSeenAt: now })
		.where(eq(participants.id, participantId));
}

export async function listSessionAnswers(
	db: Database,
	sessionId: string
): Promise<ParticipantAnswerRow[]> {
	const participantRows = await db
		.select({ id: participants.id })
		.from(participants)
		.where(eq(participants.sessionId, sessionId));

	const participantIds = participantRows.map((row) => row.id);
	if (participantIds.length === 0) return [];

	if (participantIds.length <= D1_MAX_IN_PARAMS) {
		return db
			.select()
			.from(participantAnswers)
			.where(inArray(participantAnswers.participantId, participantIds))
			.orderBy(asc(participantAnswers.submittedAt), asc(participantAnswers.id));
	}

	const chunks: string[][] = [];
	for (let i = 0; i < participantIds.length; i += D1_MAX_IN_PARAMS) {
		chunks.push(participantIds.slice(i, i + D1_MAX_IN_PARAMS));
	}

	const chunkResults = await Promise.all(
		chunks.map((chunk) =>
			db.select().from(participantAnswers).where(inArray(participantAnswers.participantId, chunk))
		)
	);
	const rows = chunkResults.flat();

	return rows.toSorted((a, b) => {
		const timeDiff = a.submittedAt.getTime() - b.submittedAt.getTime();
		if (timeDiff !== 0) return timeDiff;
		return a.id.localeCompare(b.id);
	});
}

export async function insertParticipantAnswerRow(
	db: Database,
	values: NewParticipantAnswerRow
): Promise<void> {
	await db.insert(participantAnswers).values(values).onConflictDoNothing();
}

export async function syncRoomExportToD1(db: Database, exported: RoomExportPayload): Promise<void> {
	const statements: BatchItem<'sqlite'>[] = [
		db
			.update(gameSessions)
			.set({
				status: exported.status,
				currentQuestionIndex: exported.currentQuestionIndex,
				startedAt: exported.startedAt ? new Date(exported.startedAt) : null,
				endedAt: exported.endedAt ? new Date(exported.endedAt) : null
			})
			.where(eq(gameSessions.id, exported.sessionId))
	];

	for (const participant of exported.participants) {
		statements.push(
			db
				.update(participants)
				.set({
					status: participant.status,
					lastSeenAt: new Date(participant.lastSeenAt)
				})
				.where(eq(participants.id, participant.id))
		);
	}

	const ANSWER_INSERT_ROWS_PER_STATEMENT = 12; // 12 rows * 8 columns = 96 bound parameters (< 100 D1 limit)
	const answerValues: NewParticipantAnswerRow[] = exported.answers.map((answer) => ({
		id: answer.id,
		participantId: answer.participantId,
		sessionQuestionId: answer.sessionQuestionId,
		selectedOptionId: answer.selectedOptionId,
		isCorrect: answer.isCorrect,
		scoreAwarded: answer.scoreAwarded,
		responseTimeMs: answer.responseTimeMs,
		submittedAt: new Date(answer.submittedAt)
	}));

	for (let i = 0; i < answerValues.length; i += ANSWER_INSERT_ROWS_PER_STATEMENT) {
		const chunk = answerValues.slice(i, i + ANSWER_INSERT_ROWS_PER_STATEMENT);
		if (chunk.length > 0) {
			statements.push(db.insert(participantAnswers).values(chunk).onConflictDoNothing());
		}
	}

	for (let i = 0; i < statements.length; i += D1_BATCH_CHUNK_SIZE) {
		const [first, ...rest] = statements.slice(i, i + D1_BATCH_CHUNK_SIZE);
		if (first) {
			await db.batch([first, ...rest]);
		}
	}
}
