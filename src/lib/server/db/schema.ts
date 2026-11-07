import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

export const quizStatusValues = ['draft', 'published', 'archived'] as const;
export type QuizStatus = (typeof quizStatusValues)[number];

export const gameSessionStatusValues = ['lobby', 'in_progress', 'completed', 'cancelled'] as const;
export type GameSessionStatus = (typeof gameSessionStatusValues)[number];

export const participantStatusValues = ['connected', 'disconnected', 'finished'] as const;
export type ParticipantStatus = (typeof participantStatusValues)[number];

export const teachers = sqliteTable('teachers', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	displayName: text('display_name').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const teacherSessions = sqliteTable(
	'teacher_sessions',
	{
		id: text('id').primaryKey(),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => teachers.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull().unique(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		index('teacher_sessions_teacher_id_idx').on(table.teacherId),
		index('teacher_sessions_expires_at_idx').on(table.expiresAt)
	]
);

export const quizzes = sqliteTable(
	'quizzes',
	{
		id: text('id').primaryKey(),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => teachers.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		description: text('description'),
		status: text('status', { enum: quizStatusValues }).notNull().default('draft'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		index('quizzes_teacher_id_idx').on(table.teacherId),
		index('quizzes_teacher_status_idx').on(table.teacherId, table.status)
	]
);

export const questions = sqliteTable(
	'questions',
	{
		id: text('id').primaryKey(),
		quizId: text('quiz_id')
			.notNull()
			.references(() => quizzes.id, { onDelete: 'cascade' }),
		text: text('text').notNull(),
		imageUrl: text('image_url'),
		position: integer('position').notNull(),
		timeLimitSeconds: integer('time_limit_seconds').notNull(),
		points: integer('points').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		index('questions_quiz_id_idx').on(table.quizId),
		uniqueIndex('questions_quiz_position_unique').on(table.quizId, table.position)
	]
);

export const questionOptions = sqliteTable(
	'question_options',
	{
		id: text('id').primaryKey(),
		questionId: text('question_id')
			.notNull()
			.references(() => questions.id, { onDelete: 'cascade' }),
		text: text('text').notNull(),
		position: integer('position').notNull(),
		isCorrect: integer('is_correct', { mode: 'boolean' }).notNull()
	},
	(table) => [
		index('question_options_question_id_idx').on(table.questionId),
		uniqueIndex('question_options_question_position_unique').on(table.questionId, table.position)
	]
);

export const gameSessions = sqliteTable(
	'game_sessions',
	{
		id: text('id').primaryKey(),
		quizId: text('quiz_id')
			.notNull()
			.references(() => quizzes.id, { onDelete: 'cascade' }),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => teachers.id, { onDelete: 'cascade' }),
		quizTitle: text('quiz_title').notNull(),
		joinCode: text('join_code').notNull(),
		status: text('status', { enum: gameSessionStatusValues }).notNull().default('lobby'),
		currentQuestionIndex: integer('current_question_index').notNull().default(-1),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }),
		endedAt: integer('ended_at', { mode: 'timestamp_ms' })
	},
	(table) => [
		index('game_sessions_teacher_id_idx').on(table.teacherId),
		index('game_sessions_quiz_id_idx').on(table.quizId),
		index('game_sessions_join_code_idx').on(table.joinCode)
	]
);

export const sessionQuestions = sqliteTable(
	'session_questions',
	{
		id: text('id').primaryKey(),
		sessionId: text('session_id')
			.notNull()
			.references(() => gameSessions.id, { onDelete: 'cascade' }),
		sourceQuestionId: text('source_question_id'),
		text: text('text').notNull(),
		imageUrl: text('image_url'),
		position: integer('position').notNull(),
		timeLimitSeconds: integer('time_limit_seconds').notNull(),
		points: integer('points').notNull()
	},
	(table) => [
		index('session_questions_session_id_idx').on(table.sessionId),
		uniqueIndex('session_questions_session_position_unique').on(table.sessionId, table.position)
	]
);

export const sessionQuestionOptions = sqliteTable(
	'session_question_options',
	{
		id: text('id').primaryKey(),
		sessionQuestionId: text('session_question_id')
			.notNull()
			.references(() => sessionQuestions.id, { onDelete: 'cascade' }),
		text: text('text').notNull(),
		position: integer('position').notNull(),
		isCorrect: integer('is_correct', { mode: 'boolean' }).notNull()
	},
	(table) => [
		index('session_question_options_question_id_idx').on(table.sessionQuestionId),
		uniqueIndex('session_question_options_question_position_unique').on(
			table.sessionQuestionId,
			table.position
		)
	]
);

export const participants = sqliteTable(
	'participants',
	{
		id: text('id').primaryKey(),
		sessionId: text('session_id')
			.notNull()
			.references(() => gameSessions.id, { onDelete: 'cascade' }),
		nickname: text('nickname').notNull(),
		nicknameNormalized: text('nickname_normalized').notNull(),
		participantTokenHash: text('participant_token_hash').notNull().unique(),
		status: text('status', { enum: participantStatusValues }).notNull().default('connected'),
		joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull(),
		lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		index('participants_session_id_idx').on(table.sessionId),
		uniqueIndex('participants_session_nickname_unique').on(
			table.sessionId,
			table.nicknameNormalized
		)
	]
);

export const participantAnswers = sqliteTable(
	'participant_answers',
	{
		id: text('id').primaryKey(),
		participantId: text('participant_id')
			.notNull()
			.references(() => participants.id, { onDelete: 'cascade' }),
		sessionQuestionId: text('session_question_id')
			.notNull()
			.references(() => sessionQuestions.id, { onDelete: 'cascade' }),
		selectedOptionId: text('selected_option_id')
			.notNull()
			.references(() => sessionQuestionOptions.id, { onDelete: 'cascade' }),
		isCorrect: integer('is_correct', { mode: 'boolean' }).notNull(),
		scoreAwarded: integer('score_awarded').notNull(),
		responseTimeMs: integer('response_time_ms').notNull(),
		submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		index('participant_answers_question_id_idx').on(table.sessionQuestionId),
		uniqueIndex('participant_answers_participant_question_unique').on(
			table.participantId,
			table.sessionQuestionId
		)
	]
);

export const questionImages = sqliteTable(
	'question_images',
	{
		id: text('id').primaryKey(),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => teachers.id, { onDelete: 'cascade' }),
		mimeType: text('mime_type').notNull(),
		sizeBytes: integer('size_bytes').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [index('question_images_teacher_id_idx').on(table.teacherId)]
);

export const questionImageChunks = sqliteTable(
	'question_image_chunks',
	{
		imageId: text('image_id')
			.notNull()
			.references(() => questionImages.id, { onDelete: 'cascade' }),
		chunkIndex: integer('chunk_index').notNull(),
		dataBase64: text('data_base64').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.imageId, table.chunkIndex] }),
		index('question_image_chunks_image_id_idx').on(table.imageId)
	]
);

export type TeacherRow = typeof teachers.$inferSelect;
export type NewTeacherRow = typeof teachers.$inferInsert;
export type TeacherSessionRow = typeof teacherSessions.$inferSelect;
export type NewTeacherSessionRow = typeof teacherSessions.$inferInsert;
export type QuizRow = typeof quizzes.$inferSelect;
export type NewQuizRow = typeof quizzes.$inferInsert;
export type QuestionRow = typeof questions.$inferSelect;
export type NewQuestionRow = typeof questions.$inferInsert;
export type QuestionOptionRow = typeof questionOptions.$inferSelect;
export type NewQuestionOptionRow = typeof questionOptions.$inferInsert;
export type GameSessionRow = typeof gameSessions.$inferSelect;
export type NewGameSessionRow = typeof gameSessions.$inferInsert;
export type SessionQuestionRow = typeof sessionQuestions.$inferSelect;
export type NewSessionQuestionRow = typeof sessionQuestions.$inferInsert;
export type SessionQuestionOptionRow = typeof sessionQuestionOptions.$inferSelect;
export type NewSessionQuestionOptionRow = typeof sessionQuestionOptions.$inferInsert;
export type ParticipantRow = typeof participants.$inferSelect;
export type NewParticipantRow = typeof participants.$inferInsert;
export type ParticipantAnswerRow = typeof participantAnswers.$inferSelect;
export type NewParticipantAnswerRow = typeof participantAnswers.$inferInsert;
export type QuestionImageRow = typeof questionImages.$inferSelect;
export type NewQuestionImageRow = typeof questionImages.$inferInsert;
export type QuestionImageChunkRow = typeof questionImageChunks.$inferSelect;
export type NewQuestionImageChunkRow = typeof questionImageChunks.$inferInsert;
