ALTER TABLE `quizzes` ADD `is_public` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `quizzes_is_public_status_idx` ON `quizzes` (`is_public`,`status`);