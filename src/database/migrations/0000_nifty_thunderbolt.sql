CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`target_user_id` text,
	`actor_user_id` text,
	`action` text NOT NULL,
	`result` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`correlation_id` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_target_idx` ON `audit_events` (`guild_id`,`target_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_expiry_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `migration_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`username_snapshot` text NOT NULL,
	`original_nickname` text,
	`category` text NOT NULL,
	`parsed_display_name` text,
	`parsed_game_name` text,
	`parsed_tag_line` text,
	`snapshot_fingerprint` text NOT NULL,
	`manageable` integer NOT NULL,
	`state` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_error_code` text,
	`estimated_operations` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `migration_items_job_user_unique` ON `migration_items` (`job_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `migration_items_due_idx` ON `migration_items` (`job_id`,`state`,`sequence`);--> statement-breakpoint
CREATE TABLE `migration_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`started_by` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`last_processed_user_id` text,
	`cursor_sequence` integer DEFAULT 0 NOT NULL,
	`total_members` integer DEFAULT 0 NOT NULL,
	`processed_members` integer DEFAULT 0 NOT NULL,
	`verified_members` integer DEFAULT 0 NOT NULL,
	`unregistered_members` integer DEFAULT 0 NOT NULL,
	`pending_members` integer DEFAULT 0 NOT NULL,
	`failed_members` integer DEFAULT 0 NOT NULL,
	`configuration_snapshot` text NOT NULL,
	`preview_fingerprint` text,
	`confirmation_hash` text,
	`confirmation_expires_at` integer,
	`pause_reason` text,
	`lease_owner` text,
	`lease_expires_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `migration_jobs_guild_status_idx` ON `migration_jobs` (`guild_id`,`status`);--> statement-breakpoint
CREATE TABLE `pending_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`operation_type` text NOT NULL,
	`payload` text NOT NULL,
	`priority` integer NOT NULL,
	`state_version` integer NOT NULL,
	`deduplication_key` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error_code` text,
	`terminal` integer DEFAULT false NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_operations_dedupe_unique` ON `pending_operations` (`deduplication_key`);--> statement-breakpoint
CREATE INDEX `pending_operations_due_idx` ON `pending_operations` (`terminal`,`next_attempt_at`,`priority`);--> statement-breakpoint
CREATE TABLE `registration_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_attempts_user_unique` ON `registration_attempts` (`guild_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `registration_attempts_expiry_idx` ON `registration_attempts` (`expires_at`);--> statement-breakpoint
CREATE TABLE `registrations` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`discord_username_snapshot` text,
	`status` text NOT NULL,
	`is_present` integer DEFAULT true NOT NULL,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	`retention_expires_at` integer,
	`unregistered_since` integer,
	`display_name` text,
	`name_visibility` text,
	`puuid` text,
	`game_name` text,
	`tag_line` text,
	`riot_id` text,
	`platform_region` text,
	`account_routing_group` text,
	`opgg_url` text,
	`registered_at` integer,
	`last_riot_sync_at` integer,
	`next_riot_sync_at` integer,
	`riot_sync_status` text DEFAULT 'NOT_REQUIRED' NOT NULL,
	`riot_sync_failure_count` integer DEFAULT 0 NOT NULL,
	`last_riot_sync_error_code` text,
	`last_nickname_sync_at` integer,
	`nickname_sync_status` text DEFAULT 'NOT_REQUIRED' NOT NULL,
	`last_role_sync_at` integer,
	`role_sync_status` text DEFAULT 'NOT_REQUIRED' NOT NULL,
	`migration_source` text,
	`original_migration_nickname` text,
	`migration_job_id` text,
	`state_version` integer DEFAULT 1 NOT NULL,
	`duplicate_puuid_override` integer DEFAULT false NOT NULL,
	`duplicate_override_actor_id` text,
	`duplicate_override_at` integer,
	`last_failure_code` text,
	`last_failure_at` integer,
	`cleanup_claim_version` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`),
	CONSTRAINT "registrations_status_check" CHECK("registrations"."status" in ('UNREGISTERED','PENDING_VERIFICATION','REGISTERED')),
	CONSTRAINT "registrations_visibility_check" CHECK("registrations"."name_visibility" is null or "registrations"."name_visibility" in ('VISIBLE','HIDDEN')),
	CONSTRAINT "registrations_registered_identity_check" CHECK("registrations"."status" <> 'REGISTERED' or ("registrations"."puuid" is not null and "registrations"."game_name" is not null and "registrations"."tag_line" is not null and "registrations"."platform_region" is not null and "registrations"."account_routing_group" is not null and "registrations"."name_visibility" is not null)),
	CONSTRAINT "registrations_name_visibility_check" CHECK("registrations"."status" <> 'REGISTERED' or ("registrations"."name_visibility" = 'VISIBLE' and "registrations"."display_name" is not null and length(trim("registrations"."display_name")) > 0) or ("registrations"."name_visibility" = 'HIDDEN' and "registrations"."display_name" is null)),
	CONSTRAINT "registrations_unregistered_identity_check" CHECK("registrations"."status" <> 'UNREGISTERED' or ("registrations"."puuid" is null and "registrations"."game_name" is null and "registrations"."tag_line" is null and "registrations"."riot_id" is null and "registrations"."name_visibility" is null and "registrations"."display_name" is null))
);
--> statement-breakpoint
CREATE INDEX `registrations_cleanup_idx` ON `registrations` (`guild_id`,`status`,`is_present`,`unregistered_since`);--> statement-breakpoint
CREATE INDEX `registrations_riot_due_idx` ON `registrations` (`status`,`is_present`,`next_riot_sync_at`);--> statement-breakpoint
CREATE INDEX `registrations_retention_idx` ON `registrations` (`retention_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `registrations_active_puuid_unique` ON `registrations` (`guild_id`,`puuid`) WHERE "registrations"."status" = 'REGISTERED' and "registrations"."puuid" is not null and "registrations"."duplicate_puuid_override" = 0;--> statement-breakpoint
CREATE TABLE `retained_registration_data` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`data_type` text NOT NULL,
	`value` text NOT NULL,
	`reason` text NOT NULL,
	`retained_at` integer NOT NULL,
	`purge_at` integer NOT NULL,
	`created_by_action` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `retained_data_purge_idx` ON `retained_registration_data` (`purge_at`);--> statement-breakpoint
CREATE INDEX `retained_data_user_idx` ON `retained_registration_data` (`guild_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `worker_leases` (
	`name` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
