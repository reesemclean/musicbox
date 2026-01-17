CREATE TABLE `deployment_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer,
	`playbook` text NOT NULL,
	`status` text NOT NULL,
	`output` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `devices` ADD `last_deployed_at` integer;--> statement-breakpoint
ALTER TABLE `devices` ADD `last_deployed_version` text;--> statement-breakpoint
ALTER TABLE `devices` ADD `deployment_status` text;