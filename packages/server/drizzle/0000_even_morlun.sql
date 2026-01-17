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
	`secret` text NOT NULL,
	`hardware_id` text,
	`hostname` text,
	`status` text DEFAULT 'approved',
	`ip_address` text,
	`http_port` integer DEFAULT 8080,
	`last_seen` integer,
	`current_song` text,
	`library_version` integer DEFAULT 0,
	`approved_at` integer,
	`reported_player_version` text,
	`reported_agent_version` text,
	`reported_config_version` text,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_name_unique` ON `devices` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `devices_secret_unique` ON `devices` (`secret`);--> statement-breakpoint
CREATE UNIQUE INDEX `devices_hardware_id_unique` ON `devices` (`hardware_id`);--> statement-breakpoint
CREATE TABLE `download_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text,
	`album` text,
	`target_path` text,
	`playlist_id` integer,
	`track_position` integer,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0,
	`error` text,
	`added_at` integer DEFAULT (unixepoch())
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
--> statement-breakpoint
CREATE TABLE `playlist_songs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`playlist_id` integer NOT NULL,
	`song_id` integer NOT NULL,
	`position` integer NOT NULL,
	`added_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playlists_name_unique` ON `playlists` (`name`);--> statement-breakpoint
CREATE TABLE `songs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`artist` text,
	`album` text,
	`duration` integer,
	`file_data` blob NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`youtube_video_id` text,
	`created_at` integer DEFAULT (unixepoch())
);
