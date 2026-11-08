import { buildLeaderboard, buildQuestionResults } from '../../game/engine/scoring.js';
import { ApiError } from '../api/errors.js';
import type { Database } from '../db/client.js';
import { findQuizDetailForTeacher } from '../quizzes/repository.js';
import {
	generateJoinCode,
	joinCodeSchema,
	normalizeNickname,
	type JoinSessionRequestInput
} from '../validation/session.js';
import { generateParticipantToken, hashParticipantToken } from './credentials.js';
import {
	countSessionParticipants,
	countSessionQuestions,
	findParticipantByNormalizedNickname,
	findParticipantByTokenHash,
	findSessionById,
	findSessionByJoinCode,
	getSessionSnapshotQuestions,
	insertParticipantRow,
	insertSessionWithSnapshot,
	isJoinCodeActive,
	listSessionAnswers,
	listSessionParticipants,
	listSessionsByTeacher,
	markParticipantConnected,
	syncRoomExportToD1,
	toPublicParticipantRow,
	type SessionSnapshotWrite
} from './repository.js';
import type { RoomExportPayload, RoomInitPayload, SessionRoomClient } from './room-client.js';
import {
	PROTOCOL_VERSION,
	type GameSessionStatus,
	type PublicParticipant,
	type PublicSessionLookup,
	type RoomSnapshot,
	type SessionSnapshotQuestion,
	type StudentJoinResponse,
	type TeacherLeaderboard,
	type TeacherParticipantQuestionAnswer,
	type TeacherSessionListItem,
	type TeacherSessionQuestionBreakdown,
	type TeacherSessionResults
} from '#lib/shared/session.js';

const MAX_JOIN_CODE_ATTEMPTS = 8;

export interface CreatedGameSession {
	id: string;
	quizId: string;
	teacherId: string;
	quizTitle: string;
	joinCode: string;
	status: GameSessionStatus;
	questionCount: number;
	createdAt: Date;
	snapshotQuestions: SessionSnapshotQuestion[];
}

function isUniqueNicknameError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/unique constraint failed: participants\.session_id, participants\.nickname_normalized/i.test(
			error.message
		)
	);
}

async function allocateUniqueJoinCode(db: Database): Promise<string> {
	for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
		const candidate = generateJoinCode();
		if (!(await isJoinCodeActive(db, candidate))) {
			return candidate;
		}
	}
	throw new ApiError(
		503,
		'join_code_exhausted',
		'Could not allocate a unique join code. Try again.'
	);
}

export async function createSessionFromQuiz(
	db: Database,
	roomClient: SessionRoomClient | null,
	teacherId: string,
	quizId: string,
	now: Date = new Date()
): Promise<CreatedGameSession> {
	const quiz = await findQuizDetailForTeacher(db, quizId, teacherId);
	if (!quiz) {
		throw new ApiError(404, 'quiz_not_found', 'Quiz not found.');
	}

	if (quiz.status !== 'published') {
		throw new ApiError(
			409,
			'quiz_not_published',
			'Publish this quiz before starting a live session.'
		);
	}

	if (quiz.questions.length === 0) {
		throw new ApiError(
			400,
			'invalid_quiz_for_session',
			'This quiz must have at least one question.'
		);
	}

	const sessionId = crypto.randomUUID();
	const joinCode = await allocateUniqueJoinCode(db);

	const snapshotQuestions: SessionSnapshotQuestion[] = [];
	const snapshotWrites: SessionSnapshotWrite[] = [];

	for (let qIndex = 0; qIndex < quiz.questions.length; qIndex += 1) {
		const sourceQuestion = quiz.questions[qIndex];
		if (!sourceQuestion) continue;

		const sessionQuestionId = crypto.randomUUID();
		const snapshotOptions = sourceQuestion.options.map((option, oIndex) => ({
			id: crypto.randomUUID(),
			text: option.text,
			position: oIndex,
			isCorrect: option.isCorrect
		}));

		snapshotQuestions.push({
			id: sessionQuestionId,
			sourceQuestionId: sourceQuestion.id,
			text: sourceQuestion.text,
			imageUrl: sourceQuestion.imageUrl ?? null,
			position: qIndex,
			timeLimitSeconds: sourceQuestion.timeLimitSeconds,
			points: sourceQuestion.points,
			options: snapshotOptions
		});

		snapshotWrites.push({
			question: {
				id: sessionQuestionId,
				sessionId,
				sourceQuestionId: sourceQuestion.id,
				text: sourceQuestion.text,
				imageUrl: sourceQuestion.imageUrl ?? null,
				position: qIndex,
				timeLimitSeconds: sourceQuestion.timeLimitSeconds,
				points: sourceQuestion.points
			},
			options: snapshotOptions.map((option) => ({
				id: option.id,
				sessionQuestionId,
				text: option.text,
				position: option.position,
				isCorrect: option.isCorrect
			}))
		});
	}

	await insertSessionWithSnapshot(
		db,
		{
			id: sessionId,
			quizId: quiz.id,
			teacherId,
			quizTitle: quiz.title,
			joinCode,
			status: 'lobby',
			currentQuestionIndex: -1,
			createdAt: now,
			startedAt: null,
			endedAt: null
		},
		snapshotWrites
	);

	if (roomClient) {
		const initPayload: RoomInitPayload = {
			sessionId,
			quizId: quiz.id,
			teacherId,
			quizTitle: quiz.title,
			joinCode,
			status: 'lobby',
			createdAt: now.toISOString(),
			questions: snapshotQuestions
		};
		await roomClient.initializeRoom(initPayload);
	}

	return {
		id: sessionId,
		quizId: quiz.id,
		teacherId,
		quizTitle: quiz.title,
		joinCode,
		status: 'lobby',
		questionCount: snapshotQuestions.length,
		createdAt: now,
		snapshotQuestions
	};
}

export async function lookupSessionByJoinCode(
	db: Database,
	rawCode: string
): Promise<PublicSessionLookup> {
	const parsed = joinCodeSchema.safeParse(rawCode);
	if (!parsed.success) {
		throw new ApiError(404, 'session_not_found', 'No session found for that join code.');
	}

	const session = await findSessionByJoinCode(db, parsed.data);
	if (!session) {
		throw new ApiError(404, 'session_not_found', 'No session found for that join code.');
	}

	const [questionCount, participantCount] = await Promise.all([
		countSessionQuestions(db, session.id),
		countSessionParticipants(db, session.id)
	]);

	return {
		sessionId: session.id,
		joinCode: session.joinCode,
		quizTitle: session.quizTitle,
		status: session.status,
		questionCount,
		participantCount
	};
}

export async function joinSessionByCode(
	db: Database,
	roomClient: SessionRoomClient | null,
	rawCode: string,
	input: JoinSessionRequestInput,
	now: Date = new Date()
): Promise<StudentJoinResponse> {
	const parsedCode = joinCodeSchema.safeParse(rawCode);
	if (!parsedCode.success) {
		throw new ApiError(404, 'session_not_found', 'No session found for that join code.');
	}

	const session = await findSessionByJoinCode(db, parsedCode.data);
	if (!session) {
		throw new ApiError(404, 'session_not_found', 'No session found for that join code.');
	}

	// If the student provides an existing valid token for this session, recover their identity
	if (input.participantToken) {
		const tokenHash = await hashParticipantToken(input.participantToken);
		const existing = await findParticipantByTokenHash(db, session.id, tokenHash);
		if (existing) {
			await markParticipantConnected(db, existing.id, 'connected', now);
			if (roomClient && session.status === 'lobby') {
				await roomClient
					.registerParticipant(session.id, {
						id: existing.id,
						nickname: existing.nickname,
						nicknameNormalized: existing.nicknameNormalized,
						tokenHash,
						joinedAt: existing.joinedAt.toISOString()
					})
					.catch(() => null);
			}
			return {
				sessionId: session.id,
				joinCode: session.joinCode,
				quizTitle: session.quizTitle,
				status: session.status,
				participant: {
					id: existing.id,
					nickname: existing.nickname,
					status: 'connected',
					joinedAt: existing.joinedAt.toISOString()
				},
				participantToken: input.participantToken
			};
		}
	}

	if (session.status !== 'lobby') {
		throw new ApiError(
			409,
			'session_not_joinable',
			'This session is no longer accepting new players.'
		);
	}

	const nickname = input.nickname;
	const nicknameNormalized = normalizeNickname(nickname);

	if (await findParticipantByNormalizedNickname(db, session.id, nicknameNormalized)) {
		throw new ApiError(409, 'nickname_taken', 'That nickname is already taken in this game.', {
			nickname: 'That nickname is already taken in this game.'
		});
	}

	const participantToken = generateParticipantToken();
	const participantTokenHash = await hashParticipantToken(participantToken);
	const participantId = crypto.randomUUID();

	let row;
	try {
		row = await insertParticipantRow(db, {
			id: participantId,
			sessionId: session.id,
			nickname,
			nicknameNormalized,
			participantTokenHash,
			status: 'connected',
			joinedAt: now,
			lastSeenAt: now
		});
	} catch (error) {
		if (isUniqueNicknameError(error)) {
			throw new ApiError(409, 'nickname_taken', 'That nickname is already taken in this game.', {
				nickname: 'That nickname is already taken in this game.'
			});
		}
		throw error;
	}

	const publicParticipant: PublicParticipant = toPublicParticipantRow(row);

	if (roomClient) {
		await roomClient.registerParticipant(session.id, {
			id: row.id,
			nickname: row.nickname,
			nicknameNormalized: row.nicknameNormalized,
			tokenHash: participantTokenHash,
			joinedAt: row.joinedAt.toISOString()
		});
	}

	return {
		sessionId: session.id,
		joinCode: session.joinCode,
		quizTitle: session.quizTitle,
		status: session.status,
		participant: publicParticipant,
		participantToken
	};
}

export async function syncRoomStateToD1(
	db: Database,
	roomClient: SessionRoomClient | null,
	sessionId: string
): Promise<RoomExportPayload | null> {
	if (!roomClient?.exportRoomData) return null;
	const exported = await roomClient.exportRoomData(sessionId);
	if (!exported) return null;
	await syncRoomExportToD1(db, exported);
	return exported;
}

export async function getTeacherSessionLobby(
	db: Database,
	roomClient: SessionRoomClient | null,
	teacherId: string,
	sessionId: string
): Promise<RoomSnapshot> {
	const session = await findSessionById(db, sessionId);
	if (!session || session.teacherId !== teacherId) {
		throw new ApiError(404, 'session_not_found', 'Session not found.');
	}

	if (roomClient) {
		await syncRoomStateToD1(db, roomClient, sessionId);
		const live = await roomClient.getRoomState(sessionId, 'teacher');
		if (live) return live;
	}

	const [questions, participantRows, answerRows] = await Promise.all([
		getSessionSnapshotQuestions(db, sessionId),
		listSessionParticipants(db, sessionId),
		listSessionAnswers(db, sessionId)
	]);

	const leaderboard = buildLeaderboard(
		participantRows.map((p) => ({
			id: p.id,
			nickname: p.nickname,
			joinedAt: p.joinedAt.toISOString()
		})),
		answerRows.map((a) => ({
			participantId: a.participantId,
			sessionQuestionId: a.sessionQuestionId,
			selectedOptionId: a.selectedOptionId,
			isCorrect: a.isCorrect,
			scoreAwarded: a.scoreAwarded,
			responseTimeMs: a.responseTimeMs
		}))
	);

	return {
		version: PROTOCOL_VERSION,
		sessionId: session.id,
		joinCode: session.joinCode,
		quizTitle: session.quizTitle,
		role: 'teacher',
		status: session.status,
		questionPhase:
			session.status === 'completed' || session.status === 'cancelled' ? 'closed' : 'pending',
		currentQuestionIndex: session.currentQuestionIndex,
		questionCount: questions.length,
		participants: participantRows.map(toPublicParticipantRow),
		currentQuestion: null,
		answeredCount: 0,
		leaderboard,
		startedAt: session.startedAt?.toISOString() ?? null,
		endedAt: session.endedAt?.toISOString() ?? null
	};
}

export async function getStudentSessionView(
	db: Database,
	roomClient: SessionRoomClient | null,
	rawCode: string,
	participantToken: string | null
): Promise<{
	session: PublicSessionLookup;
	participant: PublicParticipant | null;
	snapshot: RoomSnapshot | null;
}> {
	const parsed = joinCodeSchema.safeParse(rawCode);
	if (!parsed.success) {
		throw new ApiError(404, 'session_not_found', 'No session found for that join code.');
	}

	let sessionRow = await findSessionByJoinCode(db, parsed.data);
	if (!sessionRow) {
		throw new ApiError(404, 'session_not_found', 'No session found for that join code.');
	}

	if (roomClient) {
		const synced = await syncRoomStateToD1(db, roomClient, sessionRow.id);
		if (synced) {
			sessionRow = (await findSessionById(db, sessionRow.id)) ?? sessionRow;
		}
	}

	const [questionCount, participantRows] = await Promise.all([
		countSessionQuestions(db, sessionRow.id),
		listSessionParticipants(db, sessionRow.id)
	]);

	let participant: PublicParticipant | null = null;
	if (participantToken) {
		const tokenHash = await hashParticipantToken(participantToken);
		const found = await findParticipantByTokenHash(db, sessionRow.id, tokenHash);
		if (found) {
			participant = toPublicParticipantRow(found);
		}
	}

	let snapshot: RoomSnapshot | null = null;
	if (participant && roomClient) {
		snapshot = await roomClient.getRoomState(sessionRow.id, 'student', participant.id);
	}

	if (participant && !snapshot) {
		snapshot = {
			version: PROTOCOL_VERSION,
			sessionId: sessionRow.id,
			joinCode: sessionRow.joinCode,
			quizTitle: sessionRow.quizTitle,
			role: 'student',
			status: sessionRow.status,
			questionPhase:
				sessionRow.status === 'completed' || sessionRow.status === 'cancelled'
					? 'closed'
					: 'pending',
			currentQuestionIndex: sessionRow.currentQuestionIndex,
			questionCount,
			participants: participantRows.map(toPublicParticipantRow),
			selfParticipantId: participant.id,
			currentQuestion: null,
			answeredCount: 0,
			startedAt: sessionRow.startedAt?.toISOString() ?? null,
			endedAt: sessionRow.endedAt?.toISOString() ?? null
		};
	}

	return {
		session: {
			sessionId: sessionRow.id,
			joinCode: sessionRow.joinCode,
			quizTitle: sessionRow.quizTitle,
			status: sessionRow.status,
			questionCount,
			participantCount: participantRows.length
		},
		participant,
		snapshot
	};
}

export async function getTeacherSessionLeaderboard(
	db: Database,
	roomClient: SessionRoomClient | null,
	teacherId: string,
	sessionId: string
): Promise<TeacherLeaderboard> {
	const session = await findSessionById(db, sessionId);
	if (!session || session.teacherId !== teacherId) {
		throw new ApiError(404, 'session_not_found', 'Session not found.');
	}

	if (roomClient) {
		await syncRoomStateToD1(db, roomClient, sessionId);
	}

	const [participantRows, answerRows] = await Promise.all([
		listSessionParticipants(db, sessionId),
		listSessionAnswers(db, sessionId)
	]);

	const entries = buildLeaderboard(
		participantRows.map((p) => ({
			id: p.id,
			nickname: p.nickname,
			joinedAt: p.joinedAt.toISOString()
		})),
		answerRows.map((a) => ({
			participantId: a.participantId,
			sessionQuestionId: a.sessionQuestionId,
			selectedOptionId: a.selectedOptionId,
			isCorrect: a.isCorrect,
			scoreAwarded: a.scoreAwarded,
			responseTimeMs: a.responseTimeMs
		}))
	);

	return {
		sessionId: session.id,
		entries
	};
}

export async function getTeacherSessionResults(
	db: Database,
	roomClient: SessionRoomClient | null,
	teacherId: string,
	sessionId: string
): Promise<TeacherSessionResults> {
	let session = await findSessionById(db, sessionId);
	if (!session || session.teacherId !== teacherId) {
		throw new ApiError(404, 'session_not_found', 'Session not found.');
	}

	if (roomClient) {
		const synced = await syncRoomStateToD1(db, roomClient, sessionId);
		if (synced) {
			session = (await findSessionById(db, sessionId)) ?? session;
		}
	}

	const [snapshotQuestions, participantRows, answerRows] = await Promise.all([
		getSessionSnapshotQuestions(db, sessionId),
		listSessionParticipants(db, sessionId),
		listSessionAnswers(db, sessionId)
	]);

	const scoringAnswers = answerRows.map((a) => ({
		participantId: a.participantId,
		sessionQuestionId: a.sessionQuestionId,
		selectedOptionId: a.selectedOptionId,
		isCorrect: a.isCorrect,
		scoreAwarded: a.scoreAwarded,
		responseTimeMs: a.responseTimeMs
	}));

	const leaderboard = buildLeaderboard(
		participantRows.map((p) => ({
			id: p.id,
			nickname: p.nickname,
			joinedAt: p.joinedAt.toISOString()
		})),
		scoringAnswers
	);

	const questions: TeacherSessionQuestionBreakdown[] = snapshotQuestions.map((question) => {
		const answersForQuestion = answerRows.filter((ans) => ans.sessionQuestionId === question.id);
		const { teacherResult } = buildQuestionResults(
			question,
			participantRows,
			answersForQuestion.map((a) => ({
				participantId: a.participantId,
				sessionQuestionId: a.sessionQuestionId,
				selectedOptionId: a.selectedOptionId,
				isCorrect: a.isCorrect,
				scoreAwarded: a.scoreAwarded,
				responseTimeMs: a.responseTimeMs
			}))
		);

		const optionById = new Map(question.options.map((opt) => [opt.id, opt]));
		const answerByParticipant = new Map(answersForQuestion.map((ans) => [ans.participantId, ans]));

		const participantAnswersList: TeacherParticipantQuestionAnswer[] = participantRows.map(
			(participant) => {
				const submitted = answerByParticipant.get(participant.id);
				const selectedOption = submitted ? optionById.get(submitted.selectedOptionId) : undefined;
				return {
					participantId: participant.id,
					nickname: participant.nickname,
					selectedOptionId: submitted?.selectedOptionId ?? null,
					selectedOptionText: selectedOption?.text ?? null,
					isCorrect: submitted?.isCorrect ?? false,
					scoreAwarded: submitted?.scoreAwarded ?? 0,
					responseTimeMs: submitted?.responseTimeMs ?? null,
					submittedAt: submitted ? submitted.submittedAt.toISOString() : null
				};
			}
		);

		return {
			questionId: question.id,
			position: question.position,
			text: question.text,
			imageUrl: question.imageUrl ?? null,
			timeLimitSeconds: question.timeLimitSeconds,
			points: question.points,
			correctOptionId: teacherResult.correctOptionId,
			answeredCount: teacherResult.answeredCount,
			correctCount: answersForQuestion.filter((ans) => ans.isCorrect).length,
			participantCount: participantRows.length,
			optionStats: teacherResult.optionStats,
			participantAnswers: participantAnswersList
		};
	});

	return {
		sessionId: session.id,
		quizId: session.quizId,
		quizTitle: session.quizTitle,
		joinCode: session.joinCode,
		status: session.status,
		createdAt: session.createdAt.toISOString(),
		startedAt: session.startedAt ? session.startedAt.toISOString() : null,
		endedAt: session.endedAt ? session.endedAt.toISOString() : null,
		questionCount: snapshotQuestions.length,
		participantCount: participantRows.length,
		leaderboard,
		questions
	};
}

export async function listTeacherRecentSessions(
	db: Database,
	teacherId: string,
	limit: number = 10
): Promise<TeacherSessionListItem[]> {
	const rows = await listSessionsByTeacher(db, teacherId, limit);
	const items = await Promise.all(
		rows.map(async (row) => {
			const [questionCount, participantCount] = await Promise.all([
				countSessionQuestions(db, row.id),
				countSessionParticipants(db, row.id)
			]);
			return {
				id: row.id,
				quizId: row.quizId,
				quizTitle: row.quizTitle,
				joinCode: row.joinCode,
				status: row.status,
				questionCount,
				participantCount,
				createdAt: row.createdAt.toISOString(),
				startedAt: row.startedAt ? row.startedAt.toISOString() : null,
				endedAt: row.endedAt ? row.endedAt.toISOString() : null
			};
		})
	);

	return items;
}
