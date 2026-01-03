CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nfc_id` text NOT NULL,
	`content_type` text NOT NULL,
	`content_path` text,
	`action` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_nfc_id_unique` ON `cards` (`nfc_id`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`ip_address` text,
	`last_seen` integer DEFAULT (unixepoch()),
	`library_version` integer DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_name_unique` ON `devices` (`name`);--> statement-breakpoint
CREATE TABLE `download_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text,
	`album` text,
	`target_path` text,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0,
	`error` text,
	`added_at` integer DEFAULT (unixepoch()),
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `download_queue_video_id_unique` ON `download_queue` (`video_id`);--> statement-breakpoint
CREATE TABLE `library_version` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()),
	`change_description` text
);
--> statement-breakpoint
CREATE TABLE `play_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer NOT NULL,
	`song_path` text NOT NULL,
	`played_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
