PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_deployment_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer,
	`playbook` text NOT NULL,
	`status` text NOT NULL,
	`output` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_deployment_runs`("id", "device_id", "playbook", "status", "output", "started_at", "completed_at", "created_at") SELECT "id", "device_id", "playbook", "status", "output", "started_at", "completed_at", "created_at" FROM `deployment_runs`;--> statement-breakpoint
DROP TABLE `deployment_runs`;--> statement-breakpoint
ALTER TABLE `__new_deployment_runs` RENAME TO `deployment_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_play_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer NOT NULL,
	`song_path` text NOT NULL,
	`played_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_play_history`("id", "device_id", "song_path", "played_at") SELECT "id", "device_id", "song_path", "played_at" FROM `play_history`;--> statement-breakpoint
DROP TABLE `play_history`;--> statement-breakpoint
ALTER TABLE `__new_play_history` RENAME TO `play_history`;--> statement-breakpoint
CREATE TABLE `__new_download_queue` (
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
	`added_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_download_queue`("id", "video_id", "title", "artist", "album", "target_path", "playlist_id", "track_position", "status", "progress", "error", "added_at") SELECT "id", "video_id", "title", "artist", "album", "target_path", "playlist_id", "track_position", "status", "progress", "error", "added_at" FROM `download_queue`;--> statement-breakpoint
DROP TABLE `download_queue`;--> statement-breakpoint
ALTER TABLE `__new_download_queue` RENAME TO `download_queue`;--> statement-breakpoint
CREATE UNIQUE INDEX `download_queue_video_id_unique` ON `download_queue` (`video_id`);