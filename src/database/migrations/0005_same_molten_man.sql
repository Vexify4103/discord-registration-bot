CREATE TABLE `discord_audit_outbox` (
	`event_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error_code` text,
	`terminal` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `audit_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discord_audit_outbox_due_idx` ON `discord_audit_outbox` (`terminal`,`next_attempt_at`,`created_at`);