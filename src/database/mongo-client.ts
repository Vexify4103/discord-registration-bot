import { MongoClient, type ClientSession, type Collection, type Document, type IndexDescription } from "mongodb";
import type { Logger } from "pino";

export const mongoCollections = {
	registrations: "registrations",
	retainedRegistrationData: "retained_registration_data",
	migrationJobs: "migration_jobs",
	migrationItems: "migration_items",
	pendingOperations: "pending_operations",
	auditEvents: "audit_events",
	discordAuditOutbox: "discord_audit_outbox",
	registrationAttempts: "registration_attempts",
	workerLeases: "worker_leases",
	leagueProfiles: "league_profiles",
	championMasteries: "champion_masteries",
	masterySnapshots: "mastery_snapshots",
} as const;

export class MongoDatabaseContext {
	readonly client: MongoClient;
	readonly db;

	constructor(
		uri: string,
		databaseName: string,
		private readonly masteryHistoryRetentionDays: number,
		private readonly logger: Logger
	) {
		this.client = new MongoClient(uri, {
			maxPoolSize: 20,
			minPoolSize: 1,
			serverSelectionTimeoutMS: 10_000,
			connectTimeoutMS: 10_000,
			appName: "discord-registration-bot",
		});
		this.db = this.client.db(databaseName);
	}

	collection<T extends Document>(name: (typeof mongoCollections)[keyof typeof mongoCollections]): Collection<T> {
		return this.db.collection<T>(name);
	}

	async connect(): Promise<void> {
		await this.client.connect();
		const hello = await this.db.admin().command({ hello: 1 });
		if (typeof hello.setName !== "string") throw new Error("MONGODB_REPLICA_SET_REQUIRED");
		await this.ensureIndexes();
		this.logger.info({ database: this.db.databaseName, replicaSet: hello.setName }, "MongoDB persistence ready");
	}

	async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
		return this.client.withSession((session) =>
			session.withTransaction(() => work(session), {
				readConcern: { level: "snapshot" },
				writeConcern: { w: "majority" },
			})
		);
	}

	async close(): Promise<void> {
		await this.client.close();
	}

	private async ensureIndexes(): Promise<void> {
		const expirySeconds = this.masteryHistoryRetentionDays * 86_400;
		await Promise.all([
			this.indexes(mongoCollections.registrations, [
				{ key: { guildId: 1, userId: 1 }, name: "registrations_guild_user_unique", unique: true },
				{ key: { guildId: 1, status: 1, isPresent: 1, unregisteredSince: 1 }, name: "registrations_cleanup_idx" },
				{ key: { status: 1, isPresent: 1, nextRiotSyncAt: 1 }, name: "registrations_riot_due_idx" },
				{ key: { retentionExpiresAt: 1 }, name: "registrations_retention_idx" },
				{
					key: { guildId: 1, puuid: 1 },
					name: "registrations_active_puuid_unique",
					unique: true,
					partialFilterExpression: { status: "REGISTERED", puuid: { $type: "string" }, duplicatePuuidOverride: false },
				},
			]),
			this.indexes(mongoCollections.retainedRegistrationData, [
				{ key: { purgeAt: 1 }, name: "retained_data_purge_idx" },
				{ key: { purgeAtDate: 1 }, name: "retained_data_ttl", expireAfterSeconds: 0 },
				{ key: { guildId: 1, userId: 1 }, name: "retained_data_user_idx" },
			]),
			this.indexes(mongoCollections.migrationJobs, [
				{ key: { id: 1 }, name: "migration_jobs_id_unique", unique: true },
				{ key: { guildId: 1, status: 1, startedAt: -1 }, name: "migration_jobs_guild_status_idx" },
			]),
			this.indexes(mongoCollections.migrationItems, [
				{ key: { id: 1 }, name: "migration_items_id_unique", unique: true },
				{ key: { jobId: 1, userId: 1 }, name: "migration_items_job_user_unique", unique: true },
				{ key: { jobId: 1, state: 1, sequence: 1 }, name: "migration_items_due_idx" },
			]),
			this.indexes(mongoCollections.pendingOperations, [
				{ key: { id: 1 }, name: "pending_operations_id_unique", unique: true },
				{ key: { deduplicationKey: 1 }, name: "pending_operations_dedupe_unique", unique: true },
				{ key: { terminal: 1, nextAttemptAt: 1, priority: -1 }, name: "pending_operations_due_idx" },
			]),
			this.indexes(mongoCollections.auditEvents, [
				{ key: { id: 1 }, name: "audit_events_id_unique", unique: true },
				{ key: { guildId: 1, targetUserId: 1, createdAt: -1 }, name: "audit_events_target_idx" },
				{ key: { expiresAt: 1 }, name: "audit_events_ttl", expireAfterSeconds: 0 },
			]),
			this.indexes(mongoCollections.discordAuditOutbox, [
				{ key: { eventId: 1 }, name: "discord_audit_outbox_event_unique", unique: true },
				{ key: { terminal: 1, nextAttemptAt: 1, createdAt: 1 }, name: "discord_audit_outbox_due_idx" },
			]),
			this.indexes(mongoCollections.registrationAttempts, [
				{ key: { id: 1 }, name: "registration_attempts_id_unique", unique: true },
				{ key: { guildId: 1, userId: 1 }, name: "registration_attempts_user_unique", unique: true },
				{ key: { expiresAtDate: 1 }, name: "registration_attempts_ttl", expireAfterSeconds: 0 },
			]),
			this.indexes(mongoCollections.workerLeases, [{ key: { name: 1 }, name: "worker_leases_name_unique", unique: true }]),
			this.indexes(mongoCollections.leagueProfiles, [
				{ key: { guildId: 1, userId: 1 }, name: "league_profiles_guild_user_unique", unique: true },
				{ key: { statsSyncStatus: 1, nextStatsSyncAt: 1 }, name: "league_profiles_due_idx" },
			]),
			this.indexes(mongoCollections.championMasteries, [
				{ key: { guildId: 1, userId: 1, championId: 1 }, name: "champion_masteries_unique", unique: true },
				{ key: { guildId: 1, userId: 1, championPoints: -1 }, name: "champion_masteries_user_points_idx" },
				{ key: { guildId: 1, championId: 1, championPoints: -1 }, name: "champion_masteries_champion_points_idx" },
			]),
			this.indexes(mongoCollections.masterySnapshots, [
				{ key: { id: 1 }, name: "mastery_snapshots_id_unique", unique: true },
				{ key: { guildId: 1, userId: 1, championId: 1, capturedAt: -1 }, name: "mastery_snapshots_chart_idx" },
				{ key: { capturedAtDate: 1 }, name: "mastery_snapshots_ttl", expireAfterSeconds: expirySeconds },
			]),
		]);
	}

	private async indexes(collection: string, indexes: IndexDescription[]): Promise<void> {
		await this.db.collection(collection).createIndexes(indexes);
	}
}
