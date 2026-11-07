CREATE TABLE `game_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`quiz_title` text NOT NULL,
	`join_code` text NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`current_question_index` integer DEFAULT -1 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_sessions_teacher_id_idx` ON `game_sessions` (`teacher_id`);--> statement-breakpoint
CREATE INDEX `game_sessions_quiz_id_idx` ON `game_sessions` (`quiz_id`);--> statement-breakpoint
CREATE INDEX `game_sessions_join_code_idx` ON `game_sessions` (`join_code`);--> statement-breakpoint
CREATE TABLE `participant_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`session_question_id` text NOT NULL,
	`selected_option_id` text NOT NULL,
	`is_correct` integer NOT NULL,
	`score_awarded` integer NOT NULL,
	`response_time_ms` integer NOT NULL,
	`submitted_at` integer NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_question_id`) REFERENCES `session_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selected_option_id`) REFERENCES `session_question_options`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participant_answers_question_id_idx` ON `participant_answers` (`session_question_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `participant_answers_participant_question_unique` ON `participant_answers` (`participant_id`,`session_question_id`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`nickname` text NOT NULL,
	`nickname_normalized` text NOT NULL,
	`participant_token_hash` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`joined_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `game_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_participant_token_hash_unique` ON `participants` (`participant_token_hash`);--> statement-breakpoint
CREATE INDEX `participants_session_id_idx` ON `participants` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_session_nickname_unique` ON `participants` (`session_id`,`nickname_normalized`);--> statement-breakpoint
CREATE TABLE `session_question_options` (
	`id` text PRIMARY KEY NOT NULL,
	`session_question_id` text NOT NULL,
	`text` text NOT NULL,
	`position` integer NOT NULL,
	`is_correct` integer NOT NULL,
	FOREIGN KEY (`session_question_id`) REFERENCES `session_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_question_options_question_id_idx` ON `session_question_options` (`session_question_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_question_options_question_position_unique` ON `session_question_options` (`session_question_id`,`position`);--> statement-breakpoint
CREATE TABLE `session_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_question_id` text,
	`text` text NOT NULL,
	`position` integer NOT NULL,
	`time_limit_seconds` integer NOT NULL,
	`points` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `game_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_questions_session_id_idx` ON `session_questions` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_questions_session_position_unique` ON `session_questions` (`session_id`,`position`);