CREATE TABLE `question_options` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`text` text NOT NULL,
	`position` integer NOT NULL,
	`is_correct` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `question_options_question_id_idx` ON `question_options` (`question_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_options_question_position_unique` ON `question_options` (`question_id`,`position`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`text` text NOT NULL,
	`position` integer NOT NULL,
	`time_limit_seconds` integer NOT NULL,
	`points` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `questions_quiz_id_idx` ON `questions` (`quiz_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `questions_quiz_position_unique` ON `questions` (`quiz_id`,`position`);--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quizzes_teacher_id_idx` ON `quizzes` (`teacher_id`);--> statement-breakpoint
CREATE INDEX `quizzes_teacher_status_idx` ON `quizzes` (`teacher_id`,`status`);