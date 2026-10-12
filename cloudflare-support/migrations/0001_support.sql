CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`object_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_ticket` ON `attachments` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`label` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_ticket` ON `events` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`author` text NOT NULL,
	`author_id` text,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_ticket` ON `messages` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `staff` (
	`email` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`alias` text NOT NULL,
	`role` text NOT NULL,
	`categories` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`submission_id` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`username` text NOT NULL,
	`roblox_id` text,
	`discord` text,
	`details` text NOT NULL,
	`evidence` text NOT NULL,
	`access_hash` text NOT NULL,
	`owner_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`assignee` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`closed_at` integer,
	`uploads_count` integer DEFAULT 0 NOT NULL,
	`rating` integer,
	`feedback` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_reference_unique` ON `tickets` (`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_submission_unique` ON `tickets` (`submission_id`);--> statement-breakpoint
CREATE INDEX `tickets_queue` ON `tickets` (`category`,`status`,`updated_at`);