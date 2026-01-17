CREATE TABLE `podcast_episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed_id` integer NOT NULL,
	`guid` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`duration` integer,
	`published_at` integer,
	`file_data` blob,
	`mime_type` text,
	`file_size` integer,
	`source_url` text NOT NULL,
	`download_status` text DEFAULT 'pending',
	`download_error` text,
	`listened_at` integer,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`feed_id`) REFERENCES `podcast_feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `podcast_feeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`feed_url` text NOT NULL,
	`description` text,
	`image_url` text,
	`author` text,
	`last_fetched_at` integer,
	`episodes_to_keep` integer DEFAULT 3,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `podcast_feeds_feed_url_unique` ON `podcast_feeds` (`feed_url`);