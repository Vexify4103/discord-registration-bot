CREATE TABLE `champion_masteries` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`champion_id` integer NOT NULL,
	`champion_level` integer NOT NULL,
	`champion_points` integer NOT NULL,
	`last_play_time` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`, `champion_id`)
);
--> statement-breakpoint
CREATE INDEX `champion_masteries_user_points_idx` ON `champion_masteries` (`guild_id`,`user_id`,`champion_points`);--> statement-breakpoint
CREATE INDEX `champion_masteries_champion_points_idx` ON `champion_masteries` (`guild_id`,`champion_id`,`champion_points`);--> statement-breakpoint
CREATE TABLE `league_profiles` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`summoner_id` text,
	`summoner_level` integer,
	`profile_icon_id` integer,
	`solo_tier` text,
	`solo_division` text,
	`solo_league_points` integer,
	`solo_wins` integer,
	`solo_losses` integer,
	`flex_tier` text,
	`flex_division` text,
	`flex_league_points` integer,
	`flex_wins` integer,
	`flex_losses` integer,
	`effective_tier` text,
	`effective_division` text,
	`effective_league_points` integer,
	`total_mastery_score` integer DEFAULT 0 NOT NULL,
	`last_stats_sync_at` integer,
	`next_stats_sync_at` integer NOT NULL,
	`stats_sync_status` text DEFAULT 'PENDING' NOT NULL,
	`stats_sync_failure_count` integer DEFAULT 0 NOT NULL,
	`last_stats_sync_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `league_profiles_due_idx` ON `league_profiles` (`stats_sync_status`,`next_stats_sync_at`);--> statement-breakpoint
CREATE INDEX `league_profiles_rank_idx` ON `league_profiles` (`guild_id`,`effective_tier`,`effective_league_points`);--> statement-breakpoint
CREATE TABLE `mastery_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`champion_id` integer NOT NULL,
	`champion_points` integer NOT NULL,
	`captured_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mastery_snapshots_chart_idx` ON `mastery_snapshots` (`guild_id`,`user_id`,`champion_id`,`captured_at`);