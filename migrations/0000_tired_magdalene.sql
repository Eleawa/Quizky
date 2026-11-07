CREATE TABLE `teachers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teachers_email_unique` ON `teachers` (`email`);--> statement-breakpoint
CREATE TABLE `teacher_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_sessions_token_hash_unique` ON `teacher_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `teacher_sessions_teacher_id_idx` ON `teacher_sessions` (`teacher_id`);--> statement-breakpoint
CREATE INDEX `teacher_sessions_expires_at_idx` ON `teacher_sessions` (`expires_at`);
