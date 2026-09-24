CREATE TABLE `hand_results` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`stats` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `results_player` ON `hand_results` (`player_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`username` text,
	`password` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_username_unique` ON `players` (`username`);--> statement-breakpoint
CREATE TABLE `presence` (
	`room_code` text NOT NULL,
	`client_id` text NOT NULL,
	`player_id` text,
	`display` integer NOT NULL,
	`last_seen` integer NOT NULL,
	PRIMARY KEY(`room_code`, `client_id`)
);
--> statement-breakpoint
CREATE INDEX `presence_expiry` ON `presence` (`last_seen`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `limits_expiry` ON `rate_limits` (`expires`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`revision` integer NOT NULL,
	`commit_token` text NOT NULL,
	`creator_id` text NOT NULL,
	`closed` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rooms_owner` ON `rooms` (`creator_id`,`closed`);--> statement-breakpoint
CREATE INDEX `rooms_updated` ON `rooms` (`updated`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_expiry` ON `sessions` (`expires`);