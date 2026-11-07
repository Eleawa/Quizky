CREATE TABLE `question_images` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `question_images_teacher_id_idx` ON `question_images` (`teacher_id`);
--> statement-breakpoint
CREATE TABLE `question_image_chunks` (
	`image_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`data_base64` text NOT NULL,
	PRIMARY KEY(`image_id`, `chunk_index`),
	FOREIGN KEY (`image_id`) REFERENCES `question_images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `question_image_chunks_image_id_idx` ON `question_image_chunks` (`image_id`);
--> statement-breakpoint
ALTER TABLE `questions` ADD `image_url` text;
--> statement-breakpoint
ALTER TABLE `session_questions` ADD `image_url` text;
