import { DurableObject } from 'cloudflare:workers';
import {
	buildLeaderboard,
	buildQuestionResults,
	toPublicQuestion,
	type ScoringAnswerInput
} from '../../../src/lib/game/engine/scoring.js';
import {
	evaluateAnswerSubmission,
	transitionAdvanceOrTimeout,
	transitionEndGame,
	transitionSkipQuestion,
	transitionStartGame,
	type EngineRoomState
} from '../../../src/lib/game/engine/state-machine.js';
import {
	parseClientMessage,
	type ClientMessage,
	type ServerMessage
} from '../../../src/lib/game/protocol/messages.js';
import {
	PROTOCOL_VERSION,
	type GameSessionStatus,
	type LeaderboardEntry,
	type ParticipantStatus,
	type PublicParticipant,
	type PublicQuestion,
	type QuestionPhase,
	type QuestionResultForRole,
	type RoomSnapshot,
	type SessionRole,
	type SessionSnapshotOption,
	type SessionSnapshotQuestion
} from '../../../src/lib/shared/session.js';

export interface SessionRoomInfo {
	name: string;
	webSocketCount: number;
}

export interface RoomInitPayload {
	sessionId: string;
	quizId: string;
	teacherId: string;
	quizTitle: string;
	joinCode: string;
	status: GameSessionStatus;
	createdAt: string;
	questions: SessionSnapshotQuestion[];
}

export interface RoomRegisterParticipantPayload {
	id: string;
	nickname: string;
	nicknameNormalized: string;
	tokenHash: string;
	joinedAt: string;
}

export interface StoredRoomAnswer {
	id: string;
	participantId: string;
	sessionQuestionId: string;
	selectedOptionId: string;
	requestId: string;
	isCorrect: boolean;
	scoreAwarded: number;
	responseTimeMs: number;
	submittedAt: string;
}

export interface RoomExportPayload {
	sessionId: string;
	quizId: string;
	teacherId: string;
	quizTitle: string;
	joinCode: string;
	status: GameSessionStatus;
	questionPhase: QuestionPhase;
	currentQuestionIndex: number;
	createdAt: string;
	startedAt: string | null;
	endedAt: string | null;
	participants: Array<{
		id: string;
		nickname: string;
		status: ParticipantStatus;
		joinedAt: string;
		lastSeenAt: string;
	}>;
	answers: StoredRoomAnswer[];
	leaderboard: LeaderboardEntry[];
}

interface SocketAttachment {
	role: 'teacher' | 'student' | 'pending_student';
	teacherId?: string;
	participantId?: string;
}

interface StoredRoomState extends EngineRoomState {
	sessionId: string;
	quizId: string;
	teacherId: string;
	quizTitle: string;
	joinCode: string;
	createdAt: string;
}

interface StoredParticipant {
	id: string;
	nickname: string;
	nicknameNormalized: string;
	tokenHash: string;
	status: ParticipantStatus;
	joinedAt: string;
	lastSeenAt: string;
}

const encoder = new TextEncoder();
const WS_MAX_MESSAGES_PER_WINDOW = 25;
const WS_RATE_WINDOW_MS = 5_000;

interface SocketRateWindow {
	windowStartMs: number;
	count: number;
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toPublicParticipant(row: StoredParticipant): PublicParticipant {
	return {
		id: row.id,
		nickname: row.nickname,
		status: row.status,
		joinedAt: row.joinedAt
	};
}

export class SessionRoom extends DurableObject<Env> {
	private sql: SqlStorage;
	private socketRateLimits = new WeakMap<WebSocket, SocketRateWindow>();
	private cachedState: StoredRoomState | null = null;
	private cachedQuestions: SessionSnapshotQuestion[] | null = null;
	private cachedParticipants: StoredParticipant[] | null = null;
	private activeQuestionAnswerCount = -1;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.ctx.blockConcurrencyWhile(async () => {
			this.initTables();
		});
	}

	private initTables(): void {
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS room_state (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				session_id TEXT NOT NULL,
				quiz_id TEXT NOT NULL,
				teacher_id TEXT NOT NULL,
				quiz_title TEXT NOT NULL,
				join_code TEXT NOT NULL,
				status TEXT NOT NULL,
				question_phase TEXT NOT NULL,
				current_question_index INTEGER NOT NULL,
				question_opened_at TEXT,
				question_deadline_at TEXT,
				created_at TEXT NOT NULL,
				started_at TEXT,
				ended_at TEXT
			);
			CREATE TABLE IF NOT EXISTS room_questions (
				id TEXT PRIMARY KEY,
				source_question_id TEXT,
				text TEXT NOT NULL,
				image_url TEXT,
				position INTEGER NOT NULL UNIQUE,
				time_limit_seconds INTEGER NOT NULL,
				points INTEGER NOT NULL,
				options_json TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS room_participants (
				id TEXT PRIMARY KEY,
				nickname TEXT NOT NULL,
				nickname_normalized TEXT NOT NULL UNIQUE,
				token_hash TEXT NOT NULL UNIQUE,
				status TEXT NOT NULL,
				joined_at TEXT NOT NULL,
				last_seen_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS room_answers (
				id TEXT PRIMARY KEY,
				participant_id TEXT NOT NULL,
				session_question_id TEXT NOT NULL,
				selected_option_id TEXT NOT NULL,
				request_id TEXT NOT NULL,
				is_correct INTEGER NOT NULL,
				score_awarded INTEGER NOT NULL,
				response_time_ms INTEGER NOT NULL,
				submitted_at TEXT NOT NULL,
				UNIQUE(participant_id, session_question_id)
			);
			CREATE TABLE IF NOT EXISTS room_processed_requests (
				request_id TEXT PRIMARY KEY,
				created_at TEXT NOT NULL
			);
		`);

		try {
			this.sql.exec(`ALTER TABLE room_questions ADD COLUMN image_url TEXT;`);
		} catch {
			// Column already exists
		}
	}

	async ping(): Promise<'pong'> {
		return 'pong';
	}

	async info(): Promise<SessionRoomInfo> {
		return {
			name: this.ctx.id.name ?? this.ctx.id.toString(),
			webSocketCount: this.ctx.getWebSockets().length
		};
	}

	private getRoomState(): StoredRoomState | null {
		if (this.cachedState) return this.cachedState;
		const rows = this.sql
			.exec(
				`SELECT
					session_id,
					quiz_id,
					teacher_id,
					quiz_title,
					join_code,
					status,
					question_phase,
					current_question_index,
					question_opened_at,
					question_deadline_at,
					created_at,
					started_at,
					ended_at
				FROM room_state WHERE id = 1`
			)
			.toArray();

		const row = rows[0];
		if (!row) return null;

		this.cachedState = {
			sessionId: String(row.session_id),
			quizId: String(row.quiz_id),
			teacherId: String(row.teacher_id),
			quizTitle: String(row.quiz_title),
			joinCode: String(row.join_code),
			status: String(row.status) as GameSessionStatus,
			questionPhase: String(row.question_phase) as QuestionPhase,
			currentQuestionIndex: Number(row.current_question_index),
			questionOpenedAt: row.question_opened_at ? String(row.question_opened_at) : null,
			questionDeadlineAt: row.question_deadline_at ? String(row.question_deadline_at) : null,
			createdAt: String(row.created_at),
			startedAt: row.started_at ? String(row.started_at) : null,
			endedAt: row.ended_at ? String(row.ended_at) : null
		};
		return this.cachedState;
	}

	private saveEngineState(next: EngineRoomState): void {
		this.sql.exec(
			`UPDATE room_state SET
				status = ?,
				question_phase = ?,
				current_question_index = ?,
				question_opened_at = ?,
				question_deadline_at = ?,
				started_at = ?,
				ended_at = ?
			WHERE id = 1`,
			next.status,
			next.questionPhase,
			next.currentQuestionIndex,
			next.questionOpenedAt,
			next.questionDeadlineAt,
			next.startedAt,
			next.endedAt
		);

		const current = this.getRoomState();
		if (current) {
			if (current.currentQuestionIndex !== next.currentQuestionIndex) {
				this.activeQuestionAnswerCount = 0;
			}
			this.cachedState = {
				...current,
				...next
			};
		} else {
			this.cachedState = null;
		}

		if (next.status === 'completed') {
			const nowIso = next.endedAt ?? new Date().toISOString();
			this.sql.exec(`UPDATE room_participants SET status = 'finished', last_seen_at = ?`, nowIso);
			if (this.cachedParticipants) {
				for (const p of this.cachedParticipants) {
					p.status = 'finished';
					p.lastSeenAt = nowIso;
				}
			}
		}
	}

	private async scheduleRoomAlarm(alarmAtMs: number | null): Promise<void> {
		if (alarmAtMs !== null && Number.isFinite(alarmAtMs)) {
			await this.ctx.storage.setAlarm(alarmAtMs);
		} else {
			await this.ctx.storage.deleteAlarm();
		}
	}

	private hasProcessedRequest(requestId: string): boolean {
		const rows = this.sql
			.exec(
				`SELECT request_id FROM room_processed_requests WHERE request_id = ? LIMIT 1`,
				requestId
			)
			.toArray();
		return rows.length > 0;
	}

	private recordProcessedRequest(requestId: string): void {
		this.sql.exec(
			`INSERT OR IGNORE INTO room_processed_requests (request_id, created_at) VALUES (?, ?)`,
			requestId,
			new Date().toISOString()
		);
	}

	private getQuestions(): SessionSnapshotQuestion[] {
		if (this.cachedQuestions) return this.cachedQuestions;
		const rows = this.sql
			.exec(
				`SELECT id, source_question_id, text, image_url, position, time_limit_seconds, points, options_json
				FROM room_questions ORDER BY position ASC`
			)
			.toArray();

		this.cachedQuestions = rows.map((row) => ({
			id: String(row.id),
			sourceQuestionId: row.source_question_id ? String(row.source_question_id) : null,
			text: String(row.text),
			imageUrl: row.image_url ? String(row.image_url) : null,
			position: Number(row.position),
			timeLimitSeconds: Number(row.time_limit_seconds),
			points: Number(row.points),
			options: JSON.parse(String(row.options_json)) as SessionSnapshotOption[]
		}));
		return this.cachedQuestions;
	}

	private getParticipants(): StoredParticipant[] {
		if (this.cachedParticipants) return this.cachedParticipants;
		const rows = this.sql
			.exec(
				`SELECT id, nickname, nickname_normalized, token_hash, status, joined_at, last_seen_at
				FROM room_participants ORDER BY joined_at ASC, id ASC`
			)
			.toArray();

		this.cachedParticipants = rows.map((row) => ({
			id: String(row.id),
			nickname: String(row.nickname),
			nicknameNormalized: String(row.nickname_normalized),
			tokenHash: String(row.token_hash),
			status: String(row.status) as ParticipantStatus,
			joinedAt: String(row.joined_at),
			lastSeenAt: String(row.last_seen_at)
		}));
		return this.cachedParticipants;
	}

	private getAllAnswers(): StoredRoomAnswer[] {
		const rows = this.sql
			.exec(
				`SELECT
					id,
					participant_id,
					session_question_id,
					selected_option_id,
					request_id,
					is_correct,
					score_awarded,
					response_time_ms,
					submitted_at
				FROM room_answers
				ORDER BY submitted_at ASC, id ASC`
			)
			.toArray();

		return rows.map((row) => ({
			id: String(row.id),
			participantId: String(row.participant_id),
			sessionQuestionId: String(row.session_question_id),
			selectedOptionId: String(row.selected_option_id),
			requestId: String(row.request_id),
			isCorrect: Number(row.is_correct) === 1,
			scoreAwarded: Number(row.score_awarded),
			responseTimeMs: Number(row.response_time_ms),
			submittedAt: String(row.submitted_at)
		}));
	}

	private getAnswersForQuestion(sessionQuestionId: string): StoredRoomAnswer[] {
		const rows = this.sql
			.exec(
				`SELECT
					id,
					participant_id,
					session_question_id,
					selected_option_id,
					request_id,
					is_correct,
					score_awarded,
					response_time_ms,
					submitted_at
				FROM room_answers
				WHERE session_question_id = ?
				ORDER BY submitted_at ASC, id ASC`,
				sessionQuestionId
			)
			.toArray();

		return rows.map((row) => ({
			id: String(row.id),
			participantId: String(row.participant_id),
			sessionQuestionId: String(row.session_question_id),
			selectedOptionId: String(row.selected_option_id),
			requestId: String(row.request_id),
			isCorrect: Number(row.is_correct) === 1,
			scoreAwarded: Number(row.score_awarded),
			responseTimeMs: Number(row.response_time_ms),
			submittedAt: String(row.submitted_at)
		}));
	}

	private getActiveQuestionAnswerCount(sessionQuestionId: string): number {
		if (this.activeQuestionAnswerCount >= 0) {
			return this.activeQuestionAnswerCount;
		}
		const rows = this.sql
			.exec(
				`SELECT COUNT(1) AS cnt FROM room_answers WHERE session_question_id = ?`,
				sessionQuestionId
			)
			.toArray();
		this.activeQuestionAnswerCount = Number(rows[0]?.cnt ?? 0);
		return this.activeQuestionAnswerCount;
	}

	private findAnswerByParticipantAndQuestion(
		participantId: string,
		sessionQuestionId: string
	): StoredRoomAnswer | null {
		const rows = this.sql
			.exec(
				`SELECT
					id,
					participant_id,
					session_question_id,
					selected_option_id,
					request_id,
					is_correct,
					score_awarded,
					response_time_ms,
					submitted_at
				FROM room_answers
				WHERE participant_id = ? AND session_question_id = ?
				LIMIT 1`,
				participantId,
				sessionQuestionId
			)
			.toArray();

		const row = rows[0];
		if (!row) return null;

		return {
			id: String(row.id),
			participantId: String(row.participant_id),
			sessionQuestionId: String(row.session_question_id),
			selectedOptionId: String(row.selected_option_id),
			requestId: String(row.request_id),
			isCorrect: Number(row.is_correct) === 1,
			scoreAwarded: Number(row.score_awarded),
			responseTimeMs: Number(row.response_time_ms),
			submittedAt: String(row.submitted_at)
		};
	}

	private findParticipantByTokenHash(tokenHash: string): StoredParticipant | null {
		const rows = this.sql
			.exec(
				`SELECT id, nickname, nickname_normalized, token_hash, status, joined_at, last_seen_at
				FROM room_participants WHERE token_hash = ? LIMIT 1`,
				tokenHash
			)
			.toArray();

		const row = rows[0];
		if (!row) return null;

		return {
			id: String(row.id),
			nickname: String(row.nickname),
			nicknameNormalized: String(row.nickname_normalized),
			tokenHash: String(row.token_hash),
			status: String(row.status) as ParticipantStatus,
			joinedAt: String(row.joined_at),
			lastSeenAt: String(row.last_seen_at)
		};
	}

	private updateParticipantStatus(participantId: string, status: ParticipantStatus): void {
		const now = new Date().toISOString();
		this.sql.exec(
			`UPDATE room_participants SET status = ?, last_seen_at = ? WHERE id = ?`,
			status,
			now,
			participantId
		);
		if (this.cachedParticipants) {
			const found = this.cachedParticipants.find((p) => p.id === participantId);
			if (found) {
				found.status = status;
				found.lastSeenAt = now;
			}
		}
	}

	private computeLeaderboard(
		participants: StoredParticipant[] = this.getParticipants(),
		answers: StoredRoomAnswer[] = this.getAllAnswers()
	): LeaderboardEntry[] {
		const scoringInputs: ScoringAnswerInput[] = answers.map((ans) => ({
			participantId: ans.participantId,
			sessionQuestionId: ans.sessionQuestionId,
			selectedOptionId: ans.selectedOptionId,
			isCorrect: ans.isCorrect,
			scoreAwarded: ans.scoreAwarded,
			responseTimeMs: ans.responseTimeMs
		}));
		return buildLeaderboard(participants, scoringInputs);
	}

	private buildPublicQuestion(
		state: StoredRoomState,
		questions: SessionSnapshotQuestion[]
	): PublicQuestion | null {
		if (
			(state.status !== 'in_progress' && state.status !== 'completed') ||
			state.currentQuestionIndex < 0
		) {
			return null;
		}
		if (state.status === 'completed') return null;

		const current = questions[state.currentQuestionIndex];
		if (!current || !state.questionOpenedAt) return null;

		const deadlineAt = state.questionDeadlineAt ?? state.questionOpenedAt;
		return toPublicQuestion(current, questions.length, state.questionOpenedAt, deadlineAt);
	}

	private buildRoomSnapshot(role: SessionRole, selfParticipantId?: string): RoomSnapshot | null {
		const state = this.getRoomState();
		if (!state) return null;

		const questions = this.getQuestions();
		const participantRows = this.getParticipants();
		const participants = participantRows.map(toPublicParticipant);
		const activeQuestion =
			state.currentQuestionIndex >= 0 ? (questions[state.currentQuestionIndex] ?? null) : null;

		let answersForActive: StoredRoomAnswer[] = [];
		let allAnswers: StoredRoomAnswer[] | null = null;
		if (role === 'teacher' || state.questionPhase === 'closed') {
			allAnswers = this.getAllAnswers();
			answersForActive = activeQuestion
				? allAnswers.filter((ans) => ans.sessionQuestionId === activeQuestion.id)
				: [];
		}

		let hasSubmittedCurrentQuestion: boolean | undefined;
		let selectedOptionId: string | null | undefined;
		if (role === 'student' && selfParticipantId && activeQuestion) {
			if (answersForActive.length > 0) {
				const myAnswer = answersForActive.find((ans) => ans.participantId === selfParticipantId);
				hasSubmittedCurrentQuestion = Boolean(myAnswer);
				selectedOptionId = myAnswer?.selectedOptionId ?? null;
			} else {
				const myAnswer = this.findAnswerByParticipantAndQuestion(
					selfParticipantId,
					activeQuestion.id
				);
				hasSubmittedCurrentQuestion = Boolean(myAnswer);
				selectedOptionId = myAnswer?.selectedOptionId ?? null;
			}
		}

		let lastQuestionResult: QuestionResultForRole | null = null;
		if (activeQuestion && state.questionPhase === 'closed') {
			const { teacherResult, studentResults } = buildQuestionResults(
				activeQuestion,
				participantRows,
				answersForActive
			);
			if (role === 'teacher') {
				lastQuestionResult = teacherResult;
			} else if (selfParticipantId) {
				lastQuestionResult = studentResults.get(selfParticipantId) ?? {
					role: 'student',
					questionId: activeQuestion.id,
					position: activeQuestion.position,
					selectedOptionId: null,
					correctOptionId:
						activeQuestion.options.find((opt) => opt.isCorrect)?.id ??
						activeQuestion.options[0]?.id ??
						'',
					isCorrect: false,
					scoreAwarded: 0
				};
			}
		}

		const leaderboard =
			role === 'teacher'
				? this.computeLeaderboard(participantRows, allAnswers ?? this.getAllAnswers())
				: undefined;

		return {
			version: PROTOCOL_VERSION,
			sessionId: state.sessionId,
			joinCode: state.joinCode,
			quizTitle: state.quizTitle,
			role,
			status: state.status,
			questionPhase: state.questionPhase,
			currentQuestionIndex: state.currentQuestionIndex,
			questionCount: questions.length,
			participants,
			...(selfParticipantId ? { selfParticipantId } : {}),
			currentQuestion: this.buildPublicQuestion(state, questions),
			answeredCount: activeQuestion
				? allAnswers
					? answersForActive.length
					: this.getActiveQuestionAnswerCount(activeQuestion.id)
				: 0,
			...(hasSubmittedCurrentQuestion !== undefined ? { hasSubmittedCurrentQuestion } : {}),
			...(selectedOptionId !== undefined ? { selectedOptionId } : {}),
			lastQuestionResult,
			...(leaderboard ? { leaderboard } : {}),
			startedAt: state.startedAt,
			endedAt: state.endedAt
		};
	}

	private exportRoomData(): RoomExportPayload | null {
		const state = this.getRoomState();
		if (!state) return null;

		const participants = this.getParticipants();
		const answers = this.getAllAnswers();
		const leaderboard = this.computeLeaderboard(participants, answers);

		return {
			sessionId: state.sessionId,
			quizId: state.quizId,
			teacherId: state.teacherId,
			quizTitle: state.quizTitle,
			joinCode: state.joinCode,
			status: state.status,
			questionPhase: state.questionPhase,
			currentQuestionIndex: state.currentQuestionIndex,
			createdAt: state.createdAt,
			startedAt: state.startedAt,
			endedAt: state.endedAt,
			participants: participants.map((p) => ({
				id: p.id,
				nickname: p.nickname,
				status: p.status,
				joinedAt: p.joinedAt,
				lastSeenAt: p.lastSeenAt
			})),
			answers,
			leaderboard
		};
	}

	private send(ws: WebSocket, message: ServerMessage): void {
		try {
			ws.send(JSON.stringify(message));
		} catch {
			// Ignore send errors on closing sockets.
		}
	}

	private broadcastToAuthenticated(message: ServerMessage): void {
		const serialized = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets()) {
			const attachment = ws.deserializeAttachment() as SocketAttachment | null;
			if (attachment && (attachment.role === 'teacher' || attachment.role === 'student')) {
				try {
					ws.send(serialized);
				} catch {
					// Ignore closing sockets.
				}
			}
		}
	}

	private broadcastToTeachers(message: ServerMessage): void {
		const serialized = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets()) {
			const attachment = ws.deserializeAttachment() as SocketAttachment | null;
			if (attachment?.role === 'teacher') {
				try {
					ws.send(serialized);
				} catch {
					// Ignore closing sockets.
				}
			}
		}
	}

	private broadcastToStudentsByParticipant(
		builder: (participantId: string) => ServerMessage | null
	): void {
		for (const ws of this.ctx.getWebSockets()) {
			const attachment = ws.deserializeAttachment() as SocketAttachment | null;
			if (attachment?.role === 'student' && attachment.participantId) {
				const msg = builder(attachment.participantId);
				if (msg) {
					this.send(ws, msg);
				}
			}
		}
	}

	private emitQuestionClosedEvents(
		sessionId: string,
		closedQuestion: SessionSnapshotQuestion
	): LeaderboardEntry[] {
		const participants = this.getParticipants();
		const allAnswers = this.getAllAnswers();
		const answersForQuestion = allAnswers.filter(
			(ans) => ans.sessionQuestionId === closedQuestion.id
		);

		const { teacherResult, studentResults } = buildQuestionResults(
			closedQuestion,
			participants,
			answersForQuestion
		);

		this.broadcastToTeachers({
			version: PROTOCOL_VERSION,
			type: 'question_ended',
			payload: teacherResult
		});

		const defaultCorrectOptionId =
			closedQuestion.options.find((opt) => opt.isCorrect)?.id ??
			closedQuestion.options[0]?.id ??
			'';

		this.broadcastToStudentsByParticipant((participantId) => ({
			version: PROTOCOL_VERSION,
			type: 'question_ended',
			payload: studentResults.get(participantId) ?? {
				role: 'student',
				questionId: closedQuestion.id,
				position: closedQuestion.position,
				selectedOptionId: null,
				correctOptionId: defaultCorrectOptionId,
				isCorrect: false,
				scoreAwarded: 0
			}
		}));

		const leaderboard = this.computeLeaderboard(participants, allAnswers);
		this.broadcastToTeachers({
			version: PROTOCOL_VERSION,
			type: 'leaderboard_updated',
			payload: {
				sessionId,
				entries: leaderboard
			}
		});

		return leaderboard;
	}

	private emitGameCompletedEvents(
		sessionId: string,
		status: GameSessionStatus,
		endedAt: string,
		questionCount: number,
		leaderboard?: LeaderboardEntry[]
	): void {
		const participants = this.getParticipants();
		const finalLeaderboard = leaderboard ?? this.computeLeaderboard(participants);

		this.broadcastToTeachers({
			version: PROTOCOL_VERSION,
			type: 'game_completed',
			payload: {
				sessionId,
				status,
				endedAt,
				questionCount,
				participantCount: participants.length,
				leaderboard: finalLeaderboard
			}
		});

		this.broadcastToStudentsByParticipant(() => ({
			version: PROTOCOL_VERSION,
			type: 'game_completed',
			payload: {
				sessionId,
				status,
				endedAt,
				questionCount,
				participantCount: participants.length
			}
		}));
	}

	private async applyAdvanceOrTimeout(
		trigger: 'manual' | 'timeout',
		nowMs: number,
		requestId?: string
	) {
		const state = this.getRoomState();
		if (!state) {
			return {
				ok: false as const,
				code: 'invalid_state' as const,
				message: 'Session not initialized.'
			};
		}

		const questions = this.getQuestions();
		const transition = transitionAdvanceOrTimeout(state, questions, trigger, nowMs);
		if (!transition.ok) {
			return transition;
		}

		if (requestId) {
			this.recordProcessedRequest(requestId);
		}

		if (transition.action === 'no_op') {
			this.saveEngineState(transition.nextState);
			await this.scheduleRoomAlarm(transition.alarmAtMs);
			return transition;
		}

		this.saveEngineState(transition.nextState);
		await this.scheduleRoomAlarm(transition.alarmAtMs);

		if (transition.action === 'question_closed') {
			const leaderboard = this.emitQuestionClosedEvents(state.sessionId, transition.closedQuestion);

			if (transition.completedGame) {
				this.emitGameCompletedEvents(
					state.sessionId,
					transition.nextState.status,
					transition.nextState.endedAt ?? new Date(nowMs).toISOString(),
					questions.length,
					leaderboard
				);
			}
			return transition;
		}

		if (transition.action === 'question_opened') {
			const openedAt = transition.nextState.questionOpenedAt ?? new Date(nowMs).toISOString();
			const deadlineAt = transition.nextState.questionDeadlineAt ?? openedAt;
			const publicQuestion = toPublicQuestion(
				transition.openedQuestion,
				questions.length,
				openedAt,
				deadlineAt
			);
			this.broadcastToAuthenticated({
				version: PROTOCOL_VERSION,
				type: 'question_started',
				payload: publicQuestion
			});
			return transition;
		}

		return transition;
	}

	private async reconcileDeadlines(nowMs: number = Date.now()): Promise<void> {
		const questions = this.getQuestions();
		const maxSteps = Math.max(4, questions.length * 2 + 2);

		for (let step = 0; step < maxSteps; step += 1) {
			const state = this.getRoomState();
			if (!state || state.status !== 'in_progress' || !state.questionDeadlineAt) {
				return;
			}

			const deadlineMs = Date.parse(state.questionDeadlineAt);
			if (!Number.isFinite(deadlineMs)) {
				return;
			}

			if (nowMs < deadlineMs) {
				await this.scheduleRoomAlarm(deadlineMs);
				return;
			}

			const result = await this.applyAdvanceOrTimeout('timeout', nowMs);
			if (!result.ok || result.action === 'no_op') {
				return;
			}
		}
	}

	override async alarm(): Promise<void> {
		await this.reconcileDeadlines(Date.now());
	}

	private initializeRoom(payload: RoomInitPayload): RoomSnapshot {
		this.sql.exec(`DELETE FROM room_processed_requests`);
		this.sql.exec(`DELETE FROM room_answers`);
		this.sql.exec(`DELETE FROM room_questions`);
		this.sql.exec(`DELETE FROM room_participants`);
		this.sql.exec(
			`INSERT OR REPLACE INTO room_state (
				id,
				session_id,
				quiz_id,
				teacher_id,
				quiz_title,
				join_code,
				status,
				question_phase,
				current_question_index,
				question_opened_at,
				question_deadline_at,
				created_at,
				started_at,
				ended_at
			) VALUES (1, ?, ?, ?, ?, ?, ?, 'pending', -1, NULL, NULL, ?, NULL, NULL)`,
			payload.sessionId,
			payload.quizId,
			payload.teacherId,
			payload.quizTitle,
			payload.joinCode,
			payload.status,
			payload.createdAt
		);

		for (const question of payload.questions) {
			this.sql.exec(
				`INSERT INTO room_questions (
					id,
					source_question_id,
					text,
					image_url,
					position,
					time_limit_seconds,
					points,
					options_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				question.id,
				question.sourceQuestionId,
				question.text,
				question.imageUrl ?? null,
				question.position,
				question.timeLimitSeconds,
				question.points,
				JSON.stringify(question.options)
			);
		}

		this.cachedState = null;
		this.cachedQuestions = payload.questions;
		this.cachedParticipants = [];
		this.activeQuestionAnswerCount = 0;

		const snapshot = this.buildRoomSnapshot('teacher');
		if (!snapshot) {
			throw new Error('Failed to build room snapshot after initialization');
		}
		return snapshot;
	}

	private registerParticipant(payload: RoomRegisterParticipantPayload): PublicParticipant {
		const existingByToken = this.findParticipantByTokenHash(payload.tokenHash);
		if (existingByToken) {
			this.updateParticipantStatus(existingByToken.id, 'connected');
			const updated: PublicParticipant = {
				id: existingByToken.id,
				nickname: existingByToken.nickname,
				status: 'connected',
				joinedAt: existingByToken.joinedAt
			};
			this.broadcastToAuthenticated({
				version: PROTOCOL_VERSION,
				type: 'participant_joined',
				payload: updated
			});
			return updated;
		}

		this.sql.exec(
			`INSERT INTO room_participants (
				id,
				nickname,
				nickname_normalized,
				token_hash,
				status,
				joined_at,
				last_seen_at
			) VALUES (?, ?, ?, ?, 'connected', ?, ?)`,
			payload.id,
			payload.nickname,
			payload.nicknameNormalized,
			payload.tokenHash,
			payload.joinedAt,
			payload.joinedAt
		);

		if (this.cachedParticipants) {
			this.cachedParticipants.push({
				id: payload.id,
				nickname: payload.nickname,
				nicknameNormalized: payload.nicknameNormalized,
				tokenHash: payload.tokenHash,
				status: 'connected',
				joinedAt: payload.joinedAt,
				lastSeenAt: payload.joinedAt
			});
		}

		const created: PublicParticipant = {
			id: payload.id,
			nickname: payload.nickname,
			status: 'connected',
			joinedAt: payload.joinedAt
		};

		this.broadcastToAuthenticated({
			version: PROTOCOL_VERSION,
			type: 'participant_joined',
			payload: created
		});

		return created;
	}

	private async handleWebSocketUpgrade(request: Request): Promise<Response> {
		await this.reconcileDeadlines(Date.now());

		const state = this.getRoomState();
		if (!state) {
			return Response.json(
				{ error: { code: 'session_not_found', message: 'Session not found.' } },
				{ status: 404 }
			);
		}

		const roleHeader = request.headers.get('x-quizky-role');
		const teacherIdHeader = request.headers.get('x-quizky-teacher-id');
		const participantTokenHashHeader = request.headers.get('x-quizky-participant-token-hash');

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		if (roleHeader === 'teacher') {
			if (!teacherIdHeader || teacherIdHeader !== state.teacherId) {
				return Response.json(
					{ error: { code: 'forbidden', message: 'Only the session owner may host.' } },
					{ status: 403 }
				);
			}

			this.ctx.acceptWebSocket(server, ['teacher']);
			const attachment: SocketAttachment = {
				role: 'teacher',
				teacherId: teacherIdHeader
			};
			server.serializeAttachment(attachment);

			const snapshot = this.buildRoomSnapshot('teacher');
			if (snapshot) {
				this.send(server, {
					version: PROTOCOL_VERSION,
					type: 'room_snapshot',
					payload: snapshot
				});
			}

			return new Response(null, { status: 101, webSocket: client });
		}

		if (participantTokenHashHeader) {
			const participant = this.findParticipantByTokenHash(participantTokenHashHeader);
			if (participant) {
				const nextStatus = state.status === 'completed' ? 'finished' : 'connected';
				this.updateParticipantStatus(participant.id, nextStatus);
				this.ctx.acceptWebSocket(server, ['student', `participant:${participant.id}`]);
				const attachment: SocketAttachment = {
					role: 'student',
					participantId: participant.id
				};
				server.serializeAttachment(attachment);

				const snapshot = this.buildRoomSnapshot('student', participant.id);
				if (snapshot) {
					this.send(server, {
						version: PROTOCOL_VERSION,
						type: 'room_snapshot',
						payload: snapshot
					});
				}

				this.broadcastToAuthenticated({
					version: PROTOCOL_VERSION,
					type: 'participant_joined',
					payload: {
						id: participant.id,
						nickname: participant.nickname,
						status: nextStatus,
						joinedAt: participant.joinedAt
					}
				});

				return new Response(null, { status: 101, webSocket: client });
			}
		}

		this.ctx.acceptWebSocket(server, ['pending_student']);
		const pendingAttachment: SocketAttachment = { role: 'pending_student' };
		server.serializeAttachment(pendingAttachment);

		return new Response(null, { status: 101, webSocket: client });
	}

	private isSocketRateLimited(ws: WebSocket, nowMs: number = Date.now()): boolean {
		const existing = this.socketRateLimits.get(ws);
		if (!existing || nowMs - existing.windowStartMs >= WS_RATE_WINDOW_MS) {
			this.socketRateLimits.set(ws, { windowStartMs: nowMs, count: 1 });
			return false;
		}
		if (existing.count >= WS_MAX_MESSAGES_PER_WINDOW) {
			return true;
		}
		existing.count += 1;
		return false;
	}

	override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (this.isSocketRateLimited(ws)) {
			this.send(ws, {
				version: PROTOCOL_VERSION,
				type: 'error',
				payload: {
					code: 'rate_limited',
					message: 'Too many messages sent in a short window. Please slow down.'
				}
			});
			return;
		}

		if (typeof message !== 'string') {
			this.send(ws, {
				version: PROTOCOL_VERSION,
				type: 'error',
				payload: { code: 'invalid_message', message: 'Text WebSocket frames are required.' }
			});
			return;
		}

		const parsed = parseClientMessage(message);
		if (!parsed.ok) {
			this.send(ws, {
				version: PROTOCOL_VERSION,
				type: 'error',
				payload: { code: parsed.code, message: parsed.message }
			});
			return;
		}

		await this.handleClientCommand(ws, parsed.message);
	}

	private async handleClientCommand(ws: WebSocket, command: ClientMessage): Promise<void> {
		const nowMs = Date.now();
		await this.reconcileDeadlines(nowMs);

		const attachment = (ws.deserializeAttachment() as SocketAttachment | null) ?? {
			role: 'pending_student'
		};

		if (command.type === 'join_session') {
			if (command.participantToken) {
				const tokenHash = await sha256Hex(command.participantToken);
				const participant = this.findParticipantByTokenHash(tokenHash);
				if (!participant) {
					this.send(ws, {
						version: PROTOCOL_VERSION,
						type: 'error',
						payload: {
							code: 'unauthorized',
							message: 'Invalid participant credential for this session.'
						}
					});
					return;
				}

				const currentState = this.getRoomState();
				const nextStatus = currentState?.status === 'completed' ? 'finished' : 'connected';
				this.updateParticipantStatus(participant.id, nextStatus);
				const updatedAttachment: SocketAttachment = {
					role: 'student',
					participantId: participant.id
				};
				ws.serializeAttachment(updatedAttachment);

				const snapshot = this.buildRoomSnapshot('student', participant.id);
				if (snapshot) {
					this.send(ws, {
						version: PROTOCOL_VERSION,
						type: 'room_snapshot',
						payload: snapshot
					});
				}

				this.broadcastToAuthenticated({
					version: PROTOCOL_VERSION,
					type: 'participant_joined',
					payload: {
						id: participant.id,
						nickname: participant.nickname,
						status: nextStatus,
						joinedAt: participant.joinedAt
					}
				});
				return;
			}

			if (attachment.role === 'teacher') {
				const snapshot = this.buildRoomSnapshot('teacher');
				if (snapshot) {
					this.send(ws, {
						version: PROTOCOL_VERSION,
						type: 'room_snapshot',
						payload: snapshot
					});
				}
				return;
			}

			if (attachment.role === 'student' && attachment.participantId) {
				const snapshot = this.buildRoomSnapshot('student', attachment.participantId);
				if (snapshot) {
					this.send(ws, {
						version: PROTOCOL_VERSION,
						type: 'room_snapshot',
						payload: snapshot
					});
				}
				return;
			}

			this.send(ws, {
				version: PROTOCOL_VERSION,
				type: 'error',
				payload: {
					code: 'unauthorized',
					message: 'A valid participant token is required to join the session.'
				}
			});
			return;
		}

		// Commands that require teacher role
		if (
			command.type === 'teacher_start_game' ||
			command.type === 'teacher_advance_question' ||
			command.type === 'teacher_skip_question' ||
			command.type === 'teacher_end_game'
		) {
			if (attachment.role !== 'teacher') {
				this.send(ws, {
					version: PROTOCOL_VERSION,
					type: 'error',
					payload: {
						code: 'unauthorized_command',
						message: 'Only the hosting teacher can control the session.'
					}
				});
				return;
			}
		}

		const state = this.getRoomState();
		if (!state) {
			this.send(ws, {
				version: PROTOCOL_VERSION,
				type: 'error',
				payload: { code: 'invalid_state', message: 'Session not initialized.' }
			});
			return;
		}

		if (command.type === 'teacher_start_game') {
			if (this.hasProcessedRequest(command.requestId)) {
				const snapshot = this.buildRoomSnapshot('teacher');
				if (snapshot) {
					this.send(ws, {
						version: PROTOCOL_VERSION,
						type: 'room_snapshot',
						payload: snapshot
					});
				}
				return;
			}

			const questions = this.getQuestions();
			const result = transitionStartGame(state, questions, nowMs);
			if (!result.ok) {
				this.send(ws, {
					version: PROTOCOL_VERSION,
					type: 'error',
					payload: { code: result.code, message: result.message }
				});
				return;
			}

			this.recordProcessedRequest(command.requestId);
			this.saveEngineState(result.nextState);
			await this.scheduleRoomAlarm(result.alarmAtMs);

			this.broadcastToAuthenticated({
				version: PROTOCOL_VERSION,
				type: 'game_started',
				payload: { startedAt: result.nextState.startedAt ?? new Date(nowMs).toISOString() }
			});

			const openedAt = result.nextState.questionOpenedAt ?? new Date(nowMs).toISOString();
			const deadlineAt = result.nextState.questionDeadlineAt ?? openedAt;
			const publicQuestion = toPublicQuestion(
				result.openedQuestion,
				questions.length,
				openedAt,
				deadlineAt
			);
			this.broadcastToAuthenticated({
				version: PROTOCOL_VERSION,
				type: 'question_started',
				payload: publicQuestion
			});

			this.broadcastToTeachers({
				version: PROTOCOL_VERSION,
				type: 'leaderboard_updated',
				payload: {
					sessionId: state.sessionId,
					entries: this.computeLeaderboard()
				}
			});
			return;
		}

		if (command.type === 'teacher_advance_question') {
			if (this.hasProcessedRequest(command.requestId)) {
				const snapshot = this.buildRoomSnapshot('teacher');
				if (snapshot) {
					this.send(ws, {
						version: PROTOCOL_VERSION,
						type: 'room_snapshot',
						payload: snapshot
					});
				}
				return;
			}

			const result = await this.applyAdvanceOrTimeout('manual', nowMs, command.requestId);
			if (!result.ok) {
				this.send(ws, {
					version: PROTOCOL_VERSION,
					type: 'error',
					payload: { code: result.code, message: result.message }
				});
			}
			return;
		}

		if (command.type === 'teacher_skip_question') {
			if (this.hasProcessedRequest(command.requestId)) {
				const snapshot = this.buildRoomSnapshot('teacher');
				if (snapshot) {
					this.send(ws, {
						version: PROTOCOL_VERSION,
						type: 'room_snapshot',
						payload: snapshot
					});
				}
				return;
			}

			const questions = this.getQuestions();
			const result = transitionSkipQuestion(state, questions, nowMs);
			if (!result.ok) {
				this.send(ws, {
					version: PROTOCOL_VERSION,
					type: 'error',
					payload: { code: result.code, message: result.message }
				});
				return;
			}

			this.recordProcessedRequest(command.requestId);
			this.saveEngineState(result.nextState);
			await this.scheduleRoomAlarm(result.alarmAtMs);

			const leaderboard = this.emitQuestionClosedEvents(state.sessionId, result.skippedQuestion);

			if (result.action === 'question_skipped') {
				const openedAt = result.nextState.questionOpenedAt ?? new Date(nowMs).toISOString();
				const deadlineAt = result.nextState.questionDeadlineAt ?? openedAt;
				const publicQuestion = toPublicQuestion(
					result.openedQuestion,
					questions.length,
					openedAt,
					deadlineAt
				);
				this.broadcastToAuthenticated({
					version: PROTOCOL_VERSION,
					type: 'question_started',
					payload: publicQuestion
				});
				this.broadcastToTeachers({
					version: PROTOCOL_VERSION,
					type: 'leaderboard_updated',
					payload: {
						sessionId: state.sessionId,
						entries: this.computeLeaderboard()
					}
				});
			} else if (result.action === 'game_completed') {
				this.emitGameCompletedEvents(
					state.sessionId,
					result.nextState.status,
					result.nextState.endedAt ?? new Date(nowMs).toISOString(),
					questions.length,
					leaderboard
				);
			}
			return;
		}

		if (command.type === 'teacher_end_game') {
			if (this.hasProcessedRequest(command.requestId)) {
				const snapshot = this.buildRoomSnapshot('teacher');
				if (snapshot) {
					this.send(ws, {
						version: PROTOCOL_VERSION,
						type: 'room_snapshot',
						payload: snapshot
					});
				}
				return;
			}

			const questions = this.getQuestions();
			const result = transitionEndGame(state, questions, nowMs);
			if (!result.ok) {
				this.send(ws, {
					version: PROTOCOL_VERSION,
					type: 'error',
					payload: { code: result.code, message: result.message }
				});
				return;
			}

			this.recordProcessedRequest(command.requestId);
			this.saveEngineState(result.nextState);
			await this.scheduleRoomAlarm(null);

			let leaderboard: LeaderboardEntry[] | undefined;
			if (result.closedActiveQuestion) {
				leaderboard = this.emitQuestionClosedEvents(state.sessionId, result.closedActiveQuestion);
			}

			this.emitGameCompletedEvents(
				state.sessionId,
				result.nextState.status,
				result.nextState.endedAt ?? new Date(nowMs).toISOString(),
				questions.length,
				leaderboard
			);
			return;
		}

		if (command.type === 'submit_answer') {
			if (attachment.role !== 'student' || !attachment.participantId) {
				this.send(ws, {
					version: PROTOCOL_VERSION,
					type: 'error',
					payload: {
						code: 'unauthorized_command',
						message: 'Join as a participant before submitting an answer.'
					}
				});
				return;
			}

			const participantId = attachment.participantId;
			const existingAnswer = this.findAnswerByParticipantAndQuestion(
				participantId,
				command.questionId
			);

			// Idempotent retry of the exact same requestId
			if (existingAnswer && existingAnswer.requestId === command.requestId) {
				const snapshot = this.buildRoomSnapshot('student', participantId);
				if (snapshot) {
					this.send(ws, {
						version: PROTOCOL_VERSION,
						type: 'room_snapshot',
						payload: snapshot
					});
				}
				return;
			}

			const questions = this.getQuestions();
			const evaluation = evaluateAnswerSubmission(
				state,
				questions,
				{
					questionId: command.questionId,
					optionId: command.optionId,
					hasAlreadyAnswered: Boolean(existingAnswer)
				},
				nowMs
			);

			if (!evaluation.ok) {
				this.send(ws, {
					version: PROTOCOL_VERSION,
					type: 'error',
					payload: { code: evaluation.code, message: evaluation.message }
				});
				return;
			}

			const answerId = crypto.randomUUID();
			try {
				this.sql.exec(
					`INSERT INTO room_answers (
						id,
						participant_id,
						session_question_id,
						selected_option_id,
						request_id,
						is_correct,
						score_awarded,
						response_time_ms,
						submitted_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					answerId,
					participantId,
					evaluation.questionId,
					evaluation.selectedOptionId,
					command.requestId,
					evaluation.isCorrect ? 1 : 0,
					evaluation.scoreAwarded,
					evaluation.responseTimeMs,
					evaluation.submittedAt
				);
			} catch (error) {
				if (error instanceof Error && /unique/i.test(error.message)) {
					this.send(ws, {
						version: PROTOCOL_VERSION,
						type: 'error',
						payload: {
							code: 'duplicate_answer',
							message: 'You have already submitted an answer for this question.'
						}
					});
					return;
				}
				throw error;
			}

			if (this.activeQuestionAnswerCount >= 0) {
				this.activeQuestionAnswerCount += 1;
			} else {
				this.activeQuestionAnswerCount = this.getActiveQuestionAnswerCount(evaluation.questionId);
			}

			// Confirm receipt to the submitting student via updated room_snapshot
			const studentSnapshot = this.buildRoomSnapshot('student', participantId);
			if (studentSnapshot) {
				this.send(ws, {
					version: PROTOCOL_VERSION,
					type: 'room_snapshot',
					payload: studentSnapshot
				});
			}

			const answeredCount = this.getActiveQuestionAnswerCount(evaluation.questionId);
			const participantCount = this.getParticipants().length;
			this.broadcastToAuthenticated({
				version: PROTOCOL_VERSION,
				type: 'answer_received',
				payload: {
					answeredCount,
					participantCount
				}
			});
			return;
		}
	}

	private handleSocketClosed(ws: WebSocket): void {
		const attachment = ws.deserializeAttachment() as SocketAttachment | null;
		if (!attachment || attachment.role !== 'student' || !attachment.participantId) {
			return;
		}

		const participantId = attachment.participantId;
		// Check if the participant still has another open socket
		for (const other of this.ctx.getWebSockets()) {
			if (other === ws) continue;
			const otherAttachment = other.deserializeAttachment() as SocketAttachment | null;
			if (otherAttachment?.role === 'student' && otherAttachment.participantId === participantId) {
				return;
			}
		}

		const state = this.getRoomState();
		const statusOnClose = state?.status === 'completed' ? 'finished' : 'disconnected';
		this.updateParticipantStatus(participantId, statusOnClose);
		this.broadcastToAuthenticated({
			version: PROTOCOL_VERSION,
			type: 'participant_left',
			payload: { participantId }
		});
	}

	override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		this.handleSocketClosed(ws);
		try {
			ws.close(code, reason);
		} catch {
			// Already closed.
		}
	}

	override async webSocketError(ws: WebSocket): Promise<void> {
		this.handleSocketClosed(ws);
	}

	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
			return this.handleWebSocketUpgrade(request);
		}

		if (url.pathname.endsWith('/init') && request.method === 'POST') {
			const payload = (await request.json()) as RoomInitPayload;
			const snapshot = this.initializeRoom(payload);
			return Response.json({ snapshot });
		}

		if (url.pathname.endsWith('/join') && request.method === 'POST') {
			await this.reconcileDeadlines(Date.now());
			const state = this.getRoomState();
			if (!state) {
				return Response.json(
					{ error: { code: 'session_not_found', message: 'Session not found.' } },
					{ status: 404 }
				);
			}
			if (state.status !== 'lobby') {
				return Response.json(
					{
						error: {
							code: 'session_not_joinable',
							message: 'This game has already started or ended.'
						}
					},
					{ status: 409 }
				);
			}

			const payload = (await request.json()) as RoomRegisterParticipantPayload;
			try {
				const participant = this.registerParticipant(payload);
				return Response.json({ participant }, { status: 201 });
			} catch (error) {
				if (error instanceof Error && /unique/i.test(error.message)) {
					return Response.json(
						{
							error: {
								code: 'nickname_taken',
								message: 'That nickname is already taken in this game.'
							}
						},
						{ status: 409 }
					);
				}
				throw error;
			}
		}

		if (url.pathname.endsWith('/state') && request.method === 'GET') {
			await this.reconcileDeadlines(Date.now());
			const role = request.headers.get('x-quizky-role') === 'teacher' ? 'teacher' : 'student';
			const participantId = request.headers.get('x-quizky-participant-id') ?? undefined;
			const snapshot = this.buildRoomSnapshot(role, participantId);
			if (!snapshot) {
				return Response.json(
					{ error: { code: 'session_not_found', message: 'Session not found.' } },
					{ status: 404 }
				);
			}
			return Response.json({ snapshot });
		}

		if (url.pathname.endsWith('/export') && request.method === 'GET') {
			await this.reconcileDeadlines(Date.now());
			const exported = this.exportRoomData();
			if (!exported) {
				return Response.json(
					{ error: { code: 'session_not_found', message: 'Session not found.' } },
					{ status: 404 }
				);
			}
			return Response.json({ room: exported });
		}

		return Response.json(await this.info());
	}
}
