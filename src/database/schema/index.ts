import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { DiscordOperationType, LegacyCategory, NameVisibility, RegistrationStatus, SyncStatus } from "../../types/domain.js";

const timestamps = {
	createdAt: integer("created_at", { mode: "number" }).notNull(),
	updatedAt: integer("updated_at", { mode: "number" }).notNull(),
};

export const registrations = sqliteTable(
	"registrations",
	{
		guildId: text("guild_id").notNull(),
		userId: text("user_id").notNull(),
		discordUsernameSnapshot: text("discord_username_snapshot"),
		status: text("status").$type<RegistrationStatus>().notNull(),
		isPresent: integer("is_present", { mode: "boolean" }).notNull().default(true),
		joinedAt: integer("joined_at", { mode: "number" }).notNull(),
		leftAt: integer("left_at", { mode: "number" }),
		retentionExpiresAt: integer("retention_expires_at", { mode: "number" }),
		unregisteredSince: integer("unregistered_since", { mode: "number" }),
		displayName: text("display_name"),
		nameVisibility: text("name_visibility").$type<NameVisibility>(),
		puuid: text("puuid"),
		gameName: text("game_name"),
		tagLine: text("tag_line"),
		riotId: text("riot_id"),
		platformRegion: text("platform_region"),
		accountRoutingGroup: text("account_routing_group"),
		opggUrl: text("opgg_url"),
		registeredAt: integer("registered_at", { mode: "number" }),
		lastRiotSyncAt: integer("last_riot_sync_at", { mode: "number" }),
		nextRiotSyncAt: integer("next_riot_sync_at", { mode: "number" }),
		riotSyncStatus: text("riot_sync_status").$type<SyncStatus>().notNull().default("NOT_REQUIRED"),
		riotSyncFailureCount: integer("riot_sync_failure_count").notNull().default(0),
		lastRiotSyncErrorCode: text("last_riot_sync_error_code"),
		lastNicknameSyncAt: integer("last_nickname_sync_at", { mode: "number" }),
		nicknameSyncStatus: text("nickname_sync_status").$type<SyncStatus>().notNull().default("NOT_REQUIRED"),
		lastRoleSyncAt: integer("last_role_sync_at", { mode: "number" }),
		roleSyncStatus: text("role_sync_status").$type<SyncStatus>().notNull().default("NOT_REQUIRED"),
		migrationSource: text("migration_source"),
		originalMigrationNickname: text("original_migration_nickname"),
		migrationJobId: text("migration_job_id"),
		stateVersion: integer("state_version").notNull().default(1),
		duplicatePuuidOverride: integer("duplicate_puuid_override", {
			mode: "boolean",
		})
			.notNull()
			.default(false),
		duplicateOverrideActorId: text("duplicate_override_actor_id"),
		duplicateOverrideAt: integer("duplicate_override_at", { mode: "number" }),
		lastFailureCode: text("last_failure_code"),
		lastFailureAt: integer("last_failure_at", { mode: "number" }),
		cleanupClaimVersion: integer("cleanup_claim_version"),
		...timestamps,
	},
	(t) => [
		primaryKey({ columns: [t.guildId, t.userId] }),
		check("registrations_status_check", sql`${t.status} in ('UNREGISTERED','PENDING_VERIFICATION','REGISTERED','VERIFIED_NO_RIOT')`),
		check("registrations_visibility_check", sql`${t.nameVisibility} is null or ${t.nameVisibility} in ('VISIBLE','HIDDEN')`),
		check(
			"registrations_registered_identity_check",
			sql`${t.status} <> 'REGISTERED' or (${t.puuid} is not null and ${t.gameName} is not null and ${t.tagLine} is not null and ${t.platformRegion} is not null and ${t.accountRoutingGroup} is not null and ${t.nameVisibility} is not null)`
		),
		check(
			"registrations_name_visibility_check",
			sql`${t.status} <> 'REGISTERED' or (${t.nameVisibility} = 'VISIBLE' and ${t.displayName} is not null and length(trim(${t.displayName})) > 0) or (${t.nameVisibility} = 'HIDDEN' and ${t.displayName} is null)`
		),
		check(
			"registrations_verified_no_riot_check",
			sql`${t.status} <> 'VERIFIED_NO_RIOT' or (${t.nameVisibility} = 'VISIBLE' and ${t.displayName} is not null and length(trim(${t.displayName})) > 0 and ${t.puuid} is null and ${t.gameName} is null and ${t.tagLine} is null and ${t.riotId} is null and ${t.platformRegion} is null and ${t.accountRoutingGroup} is null and ${t.opggUrl} is null)`
		),
		check(
			"registrations_unregistered_identity_check",
			sql`${t.status} <> 'UNREGISTERED' or (${t.puuid} is null and ${t.gameName} is null and ${t.tagLine} is null and ${t.riotId} is null and ${t.nameVisibility} is null and ${t.displayName} is null)`
		),
		index("registrations_cleanup_idx").on(t.guildId, t.status, t.isPresent, t.unregisteredSince),
		index("registrations_riot_due_idx").on(t.status, t.isPresent, t.nextRiotSyncAt),
		index("registrations_retention_idx").on(t.retentionExpiresAt),
		uniqueIndex("registrations_active_puuid_unique")
			.on(t.guildId, t.puuid)
			.where(sql`${t.status} = 'REGISTERED' and ${t.puuid} is not null and ${t.duplicatePuuidOverride} = 0`),
	]
);

export const retainedRegistrationData = sqliteTable(
	"retained_registration_data",
	{
		id: text("id").primaryKey(),
		guildId: text("guild_id").notNull(),
		userId: text("user_id").notNull(),
		dataType: text("data_type").notNull(),
		value: text("value").notNull(),
		reason: text("reason").notNull(),
		retainedAt: integer("retained_at", { mode: "number" }).notNull(),
		purgeAt: integer("purge_at", { mode: "number" }).notNull(),
		createdByAction: text("created_by_action").notNull(),
	},
	(t) => [index("retained_data_purge_idx").on(t.purgeAt), index("retained_data_user_idx").on(t.guildId, t.userId)]
);

export const migrationJobs = sqliteTable(
	"migration_jobs",
	{
		id: text("id").primaryKey(),
		guildId: text("guild_id").notNull(),
		status: text("status").notNull(),
		mode: text("mode").notNull(),
		startedBy: text("started_by").notNull(),
		startedAt: integer("started_at", { mode: "number" }).notNull(),
		completedAt: integer("completed_at", { mode: "number" }),
		lastProcessedUserId: text("last_processed_user_id"),
		cursorSequence: integer("cursor_sequence").notNull().default(0),
		totalMembers: integer("total_members").notNull().default(0),
		processedMembers: integer("processed_members").notNull().default(0),
		verifiedMembers: integer("verified_members").notNull().default(0),
		unregisteredMembers: integer("unregistered_members").notNull().default(0),
		pendingMembers: integer("pending_members").notNull().default(0),
		failedMembers: integer("failed_members").notNull().default(0),
		configurationSnapshot: text("configuration_snapshot").notNull(),
		previewFingerprint: text("preview_fingerprint"),
		confirmationHash: text("confirmation_hash"),
		confirmationExpiresAt: integer("confirmation_expires_at", {
			mode: "number",
		}),
		pauseReason: text("pause_reason"),
		leaseOwner: text("lease_owner"),
		leaseExpiresAt: integer("lease_expires_at", { mode: "number" }),
		updatedAt: integer("updated_at", { mode: "number" }).notNull(),
	},
	(t) => [index("migration_jobs_guild_status_idx").on(t.guildId, t.status)]
);

export const migrationItems = sqliteTable(
	"migration_items",
	{
		id: text("id").primaryKey(),
		jobId: text("job_id").notNull(),
		sequence: integer("sequence").notNull(),
		guildId: text("guild_id").notNull(),
		userId: text("user_id").notNull(),
		usernameSnapshot: text("username_snapshot").notNull(),
		originalNickname: text("original_nickname"),
		category: text("category").$type<LegacyCategory>().notNull(),
		parsedDisplayName: text("parsed_display_name"),
		parsedGameName: text("parsed_game_name"),
		parsedTagLine: text("parsed_tag_line"),
		snapshotFingerprint: text("snapshot_fingerprint").notNull(),
		manageable: integer("manageable", { mode: "boolean" }).notNull(),
		state: text("state").notNull(),
		attemptCount: integer("attempt_count").notNull().default(0),
		nextAttemptAt: integer("next_attempt_at", { mode: "number" }),
		lastErrorCode: text("last_error_code"),
		estimatedOperations: text("estimated_operations").notNull(),
		metadata: text("metadata").notNull().default("{}"),
		createdAt: integer("created_at", { mode: "number" }).notNull(),
		updatedAt: integer("updated_at", { mode: "number" }).notNull(),
	},
	(t) => [uniqueIndex("migration_items_job_user_unique").on(t.jobId, t.userId), index("migration_items_due_idx").on(t.jobId, t.state, t.sequence)]
);

export const pendingOperations = sqliteTable(
	"pending_operations",
	{
		id: text("id").primaryKey(),
		guildId: text("guild_id").notNull(),
		userId: text("user_id").notNull(),
		operationType: text("operation_type").$type<DiscordOperationType>().notNull(),
		payload: text("payload").notNull(),
		priority: integer("priority").notNull(),
		stateVersion: integer("state_version").notNull(),
		deduplicationKey: text("deduplication_key").notNull(),
		attemptCount: integer("attempt_count").notNull().default(0),
		nextAttemptAt: integer("next_attempt_at", { mode: "number" }).notNull(),
		lastErrorCode: text("last_error_code"),
		terminal: integer("terminal", { mode: "boolean" }).notNull().default(false),
		leaseOwner: text("lease_owner"),
		leaseExpiresAt: integer("lease_expires_at", { mode: "number" }),
		...timestamps,
	},
	(t) => [uniqueIndex("pending_operations_dedupe_unique").on(t.deduplicationKey), index("pending_operations_due_idx").on(t.terminal, t.nextAttemptAt, t.priority)]
);

export const auditEvents = sqliteTable(
	"audit_events",
	{
		id: text("id").primaryKey(),
		guildId: text("guild_id").notNull(),
		targetUserId: text("target_user_id"),
		actorUserId: text("actor_user_id"),
		action: text("action").notNull(),
		result: text("result").notNull(),
		metadata: text("metadata").notNull().default("{}"),
		correlationId: text("correlation_id").notNull(),
		schemaVersion: integer("schema_version").notNull().default(1),
		createdAt: integer("created_at", { mode: "number" }).notNull(),
	},
	(t) => [index("audit_events_target_idx").on(t.guildId, t.targetUserId, t.createdAt), index("audit_events_expiry_idx").on(t.createdAt)]
);

export const registrationAttempts = sqliteTable(
	"registration_attempts",
	{
		id: text("id").primaryKey(),
		guildId: text("guild_id").notNull(),
		userId: text("user_id").notNull(),
		actorUserId: text("actor_user_id").notNull(),
		expiresAt: integer("expires_at", { mode: "number" }).notNull(),
		createdAt: integer("created_at", { mode: "number" }).notNull(),
	},
	(t) => [uniqueIndex("registration_attempts_user_unique").on(t.guildId, t.userId), index("registration_attempts_expiry_idx").on(t.expiresAt)]
);

export const workerLeases = sqliteTable("worker_leases", {
	name: text("name").primaryKey(),
	owner: text("owner").notNull(),
	expiresAt: integer("expires_at", { mode: "number" }).notNull(),
	updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

export type Registration = typeof registrations.$inferSelect;
export type NewRegistration = typeof registrations.$inferInsert;
export type PendingOperation = typeof pendingOperations.$inferSelect;
export type MigrationJob = typeof migrationJobs.$inferSelect;
export type MigrationItem = typeof migrationItems.$inferSelect;
