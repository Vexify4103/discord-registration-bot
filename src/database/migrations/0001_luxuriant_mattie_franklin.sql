PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_registrations` (
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
	CONSTRAINT "registrations_status_check" CHECK("__new_registrations"."status" in ('UNREGISTERED','PENDING_VERIFICATION','REGISTERED','VERIFIED_NO_RIOT')),
	CONSTRAINT "registrations_visibility_check" CHECK("__new_registrations"."name_visibility" is null or "__new_registrations"."name_visibility" in ('VISIBLE','HIDDEN')),
	CONSTRAINT "registrations_registered_identity_check" CHECK("__new_registrations"."status" <> 'REGISTERED' or ("__new_registrations"."puuid" is not null and "__new_registrations"."game_name" is not null and "__new_registrations"."tag_line" is not null and "__new_registrations"."platform_region" is not null and "__new_registrations"."account_routing_group" is not null and "__new_registrations"."name_visibility" is not null)),
	CONSTRAINT "registrations_name_visibility_check" CHECK("__new_registrations"."status" <> 'REGISTERED' or ("__new_registrations"."name_visibility" = 'VISIBLE' and "__new_registrations"."display_name" is not null and length(trim("__new_registrations"."display_name")) > 0) or ("__new_registrations"."name_visibility" = 'HIDDEN' and "__new_registrations"."display_name" is null)),
	CONSTRAINT "registrations_verified_no_riot_check" CHECK("__new_registrations"."status" <> 'VERIFIED_NO_RIOT' or ("__new_registrations"."name_visibility" = 'VISIBLE' and "__new_registrations"."display_name" is not null and length(trim("__new_registrations"."display_name")) > 0 and "__new_registrations"."puuid" is null and "__new_registrations"."game_name" is null and "__new_registrations"."tag_line" is null and "__new_registrations"."riot_id" is null and "__new_registrations"."platform_region" is null and "__new_registrations"."account_routing_group" is null and "__new_registrations"."opgg_url" is null)),
	CONSTRAINT "registrations_unregistered_identity_check" CHECK("__new_registrations"."status" <> 'UNREGISTERED' or ("__new_registrations"."puuid" is null and "__new_registrations"."game_name" is null and "__new_registrations"."tag_line" is null and "__new_registrations"."riot_id" is null and "__new_registrations"."name_visibility" is null and "__new_registrations"."display_name" is null))
);
--> statement-breakpoint
INSERT INTO `__new_registrations`("guild_id", "user_id", "discord_username_snapshot", "status", "is_present", "joined_at", "left_at", "retention_expires_at", "unregistered_since", "display_name", "name_visibility", "puuid", "game_name", "tag_line", "riot_id", "platform_region", "account_routing_group", "opgg_url", "registered_at", "last_riot_sync_at", "next_riot_sync_at", "riot_sync_status", "riot_sync_failure_count", "last_riot_sync_error_code", "last_nickname_sync_at", "nickname_sync_status", "last_role_sync_at", "role_sync_status", "migration_source", "original_migration_nickname", "migration_job_id", "state_version", "duplicate_puuid_override", "duplicate_override_actor_id", "duplicate_override_at", "last_failure_code", "last_failure_at", "cleanup_claim_version", "created_at", "updated_at") SELECT "guild_id", "user_id", "discord_username_snapshot", "status", "is_present", "joined_at", "left_at", "retention_expires_at", "unregistered_since", "display_name", "name_visibility", "puuid", "game_name", "tag_line", "riot_id", "platform_region", "account_routing_group", "opgg_url", "registered_at", "last_riot_sync_at", "next_riot_sync_at", "riot_sync_status", "riot_sync_failure_count", "last_riot_sync_error_code", "last_nickname_sync_at", "nickname_sync_status", "last_role_sync_at", "role_sync_status", "migration_source", "original_migration_nickname", "migration_job_id", "state_version", "duplicate_puuid_override", "duplicate_override_actor_id", "duplicate_override_at", "last_failure_code", "last_failure_at", "cleanup_claim_version", "created_at", "updated_at" FROM `registrations`;--> statement-breakpoint
DROP TABLE `registrations`;--> statement-breakpoint
ALTER TABLE `__new_registrations` RENAME TO `registrations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `registrations_cleanup_idx` ON `registrations` (`guild_id`,`status`,`is_present`,`unregistered_since`);--> statement-breakpoint
CREATE INDEX `registrations_riot_due_idx` ON `registrations` (`status`,`is_present`,`next_riot_sync_at`);--> statement-breakpoint
CREATE INDEX `registrations_retention_idx` ON `registrations` (`retention_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `registrations_active_puuid_unique` ON `registrations` (`guild_id`,`puuid`) WHERE "registrations"."status" = 'REGISTERED' and "registrations"."puuid" is not null and "registrations"."duplicate_puuid_override" = 0;
--> statement-breakpoint
UPDATE `migration_jobs`
SET
	`processed_members` = max(0, `processed_members` - (
		SELECT count(*) FROM `migration_items`
		WHERE `migration_items`.`job_id` = `migration_jobs`.`id`
			AND (
				(`category` = 'LEGACY_UNREGISTERED' AND `state` = 'UNREGISTERED' AND `original_nickname` LIKE '% | ?#?' AND trim(substr(`original_nickname`, 1, instr(`original_nickname`, ' | ') - 1)) <> '?')
				OR (`category` = 'LEGACY_REGISTERED_VISIBLE_NAME' AND `state` IN ('UNREGISTERED', 'MANUAL_REVIEW') AND `last_error_code` IN ('RIOT_NOT_FOUND', 'RIOT_NOT_FOUND_MANUAL_REVIEW'))
			)
	)),
	`unregistered_members` = max(0, `unregistered_members` - (
		SELECT count(*) FROM `migration_items`
		WHERE `migration_items`.`job_id` = `migration_jobs`.`id`
			AND `state` = 'UNREGISTERED'
			AND (
				(`category` = 'LEGACY_UNREGISTERED' AND `original_nickname` LIKE '% | ?#?' AND trim(substr(`original_nickname`, 1, instr(`original_nickname`, ' | ') - 1)) <> '?')
				OR (`category` = 'LEGACY_REGISTERED_VISIBLE_NAME' AND `last_error_code` = 'RIOT_NOT_FOUND')
			)
	)),
	`pending_members` = max(0, `pending_members` - (
		SELECT count(*) FROM `migration_items`
		WHERE `migration_items`.`job_id` = `migration_jobs`.`id`
			AND `category` = 'LEGACY_REGISTERED_VISIBLE_NAME'
			AND `state` = 'MANUAL_REVIEW'
			AND `last_error_code` = 'RIOT_NOT_FOUND_MANUAL_REVIEW'
	))
WHERE EXISTS (
	SELECT 1 FROM `migration_items`
	WHERE `migration_items`.`job_id` = `migration_jobs`.`id`
		AND (
			(`category` = 'LEGACY_UNREGISTERED' AND `state` = 'UNREGISTERED' AND `original_nickname` LIKE '% | ?#?' AND trim(substr(`original_nickname`, 1, instr(`original_nickname`, ' | ') - 1)) <> '?')
			OR (`category` = 'LEGACY_REGISTERED_VISIBLE_NAME' AND `state` IN ('UNREGISTERED', 'MANUAL_REVIEW') AND `last_error_code` IN ('RIOT_NOT_FOUND', 'RIOT_NOT_FOUND_MANUAL_REVIEW'))
		)
);
--> statement-breakpoint
UPDATE `migration_items`
SET
	`category` = 'LEGACY_VERIFIED_NO_RIOT',
	`parsed_display_name` = trim(substr(`original_nickname`, 1, instr(`original_nickname`, ' | ') - 1)),
	`state` = CASE WHEN `state` = 'UNREGISTERED' THEN 'PREVIEWED' ELSE `state` END,
	`attempt_count` = CASE WHEN `state` = 'UNREGISTERED' THEN 0 ELSE `attempt_count` END,
	`next_attempt_at` = CASE WHEN `state` = 'UNREGISTERED' THEN NULL ELSE `next_attempt_at` END,
	`last_error_code` = CASE WHEN `state` = 'UNREGISTERED' THEN NULL ELSE `last_error_code` END,
	`estimated_operations` = '["ROLE_CHANGES"]'
WHERE `category` = 'LEGACY_UNREGISTERED'
	AND `original_nickname` LIKE '% | ?#?'
	AND trim(substr(`original_nickname`, 1, instr(`original_nickname`, ' | ') - 1)) <> '?';
--> statement-breakpoint
UPDATE `migration_items`
SET
	`state` = 'PREVIEWED',
	`attempt_count` = 0,
	`next_attempt_at` = NULL,
	`last_error_code` = NULL
WHERE `category` = 'LEGACY_REGISTERED_VISIBLE_NAME'
	AND `state` IN ('UNREGISTERED', 'MANUAL_REVIEW')
	AND `last_error_code` IN ('RIOT_NOT_FOUND', 'RIOT_NOT_FOUND_MANUAL_REVIEW');
