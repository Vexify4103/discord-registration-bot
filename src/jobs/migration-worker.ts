import type { Client } from "discord.js";
import type { Logger } from "pino";
import type { AppConfig } from "../config/schema.js";
import { RiotAccountService } from "../integrations/riot/riot-account-service.js";
import { memberFingerprint } from "../services/migration-service.js";
import { MigrationRepository } from "../repositories/migration-repository.js";
import { DuplicatePuuidError, RegistrationRepository } from "../repositories/registration-repository.js";
import { WorkerLeaseRepository } from "../repositories/worker-lease-repository.js";
import { buildOpggUrl } from "../parsers/opgg-parser.js";

export class MigrationWorker {
	private timer?: NodeJS.Timeout;
	private running = false;
	constructor(
		private readonly client: Client,
		private readonly config: AppConfig,
		private readonly migrations: MigrationRepository,
		private readonly registrations: RegistrationRepository,
		private readonly riot: RiotAccountService,
		private readonly leases: WorkerLeaseRepository,
		private readonly logger: Logger
	) {}
	start(): void {
		this.timer = setInterval(() => void this.tick(), 3_000);
		void this.tick();
	}
	stop(): void {
		if (this.timer) clearInterval(this.timer);
	}

	async tick(): Promise<void> {
		if (this.running) return;
		const job = this.migrations.running(this.config.DISCORD_GUILD_ID);
		if (!job) return;
		if (!this.leases.acquire("migration", 60_000)) return;
		this.running = true;
		try {
			const item = this.migrations.next(job.id);
			if (!item) {
				this.migrations.finishIfDone(job.id);
				return;
			}
			const guild = await this.client.guilds.fetch(job.guildId);
			let member;
			try {
				member = await guild.members.fetch(item.userId);
			} catch {
				this.migrations.completeItem(item, "SKIPPED", "MEMBER_LEFT");
				return;
			}
			if (memberFingerprint(member) !== item.snapshotFingerprint) {
				this.migrations.completeItem(item, "FAILED", "SNAPSHOT_CHANGED");
				return;
			}
			if (item.category === "EXEMPT" || item.category === "UNMANAGEABLE") {
				this.registrations.setPendingMigration(job.guildId, item.userId, member.user.username, member.joinedTimestamp ?? Date.now(), job.id, item.originalNickname);
				this.migrations.completeItem(item, "SKIPPED");
				return;
			}
			if (item.category === "UNKNOWN_FORMAT") {
				if (this.config.UNKNOWN_MEMBER_MIGRATION_POLICY !== "unregister") {
					this.registrations.setPendingMigration(job.guildId, item.userId, member.user.username, member.joinedTimestamp ?? Date.now(), job.id, item.originalNickname);
					this.migrations.completeItem(item, this.config.UNKNOWN_MEMBER_MIGRATION_POLICY === "require-manual-review" ? "MANUAL_REVIEW" : "SKIPPED", "MANUAL_REVIEW");
					return;
				}
				this.applyUnregistered(member.id, member.user.username, member.joinedTimestamp ?? Date.now(), job.id, item.originalNickname, job.startedBy);
				this.migrations.completeItem(item, "UNREGISTERED");
				return;
			}
			if (item.category === "LEGACY_VERIFIED_NO_RIOT") {
				if (!item.parsedDisplayName) {
					this.migrations.completeItem(item, "FAILED", "INVALID_PARSED_DISPLAY_NAME");
					return;
				}
				this.applyVerifiedWithoutRiot(item, member.user.username, member.joinedTimestamp ?? Date.now(), job.startedBy, "LEGACY_NO_RIOT");
				this.migrations.completeItem(item, "VERIFIED_NO_RIOT");
				return;
			}
			if (item.category === "LEGACY_UNREGISTERED") {
				this.applyUnregistered(member.id, member.user.username, member.joinedTimestamp ?? Date.now(), job.id, item.originalNickname, job.startedBy);
				this.migrations.completeItem(item, "UNREGISTERED");
				return;
			}
			if (!item.parsedGameName || !item.parsedTagLine) {
				this.migrations.completeItem(item, "FAILED", "INVALID_PARSED_IDENTITY");
				return;
			}
			let temporary = false;
			let authFailure = false;
			for (const route of this.config.LEGACY_RIOT_ACCOUNT_ROUTES.length ? this.config.LEGACY_RIOT_ACCOUNT_ROUTES : [this.config.DEFAULT_RIOT_ACCOUNT_ROUTE]) {
				const result = await this.riot.byRiotId(route, item.parsedGameName, item.parsedTagLine, 50);
				if (result.kind === "success") {
					const visibility = item.category === "LEGACY_REGISTERED_HIDDEN_NAME" ? ("HIDDEN" as const) : ("VISIBLE" as const);
					try {
						this.registrations.saveRegistered({
							guildId: job.guildId,
							userId: item.userId,
							actorUserId: job.startedBy,
							discordUsername: member.user.username,
							displayName: visibility === "VISIBLE" ? item.parsedDisplayName : null,
							nameVisibility: visibility,
							identity: {
								...result.account,
								riotId: `${result.account.gameName}#${result.account.tagLine}`,
								platformRegion: this.config.DEFAULT_RIOT_PLATFORM_REGION,
								accountRoutingGroup: route,
								opggUrl: buildOpggUrl(this.config.DEFAULT_RIOT_PLATFORM_REGION, result.account.gameName, result.account.tagLine),
							},
							priority: 50,
						});
					} catch (error) {
						if (!(error instanceof DuplicatePuuidError)) throw error;
						this.registrations.setPendingMigration(job.guildId, item.userId, member.user.username, member.joinedTimestamp ?? Date.now(), job.id, item.originalNickname);
						this.migrations.completeItem(item, "MANUAL_REVIEW", "DUPLICATE_PUUID_MANUAL_REVIEW", {
							conflictingUserId: error.conflictingUserId,
						});
						return;
					}
					this.migrations.completeItem(item, "VERIFIED");
					return;
				}
				if (result.kind === "authentication-failure") {
					authFailure = true;
					break;
				}
				if (result.kind === "temporary-failure") {
					temporary = true;
					break;
				}
			}
			if (authFailure) {
				this.registrations.setPendingMigration(job.guildId, item.userId, member.user.username, member.joinedTimestamp ?? Date.now(), job.id, item.originalNickname);
				this.migrations.pause(job.id, "RIOT_AUTHENTICATION");
				return;
			}
			if (temporary) {
				this.registrations.setPendingMigration(job.guildId, item.userId, member.user.username, member.joinedTimestamp ?? Date.now(), job.id, item.originalNickname);
				this.migrations.completeItem(item, "PENDING", "RIOT_TEMPORARY");
				return;
			}
			if (item.category === "LEGACY_REGISTERED_VISIBLE_NAME" && item.parsedDisplayName) {
				this.applyVerifiedWithoutRiot(item, member.user.username, member.joinedTimestamp ?? Date.now(), job.startedBy, "RIOT_NOT_FOUND");
				this.migrations.completeItem(item, "VERIFIED_NO_RIOT", "RIOT_NOT_FOUND");
				return;
			}
			this.registrations.setPendingMigration(job.guildId, item.userId, member.user.username, member.joinedTimestamp ?? Date.now(), job.id, item.originalNickname);
			this.migrations.completeItem(item, "MANUAL_REVIEW", "RIOT_NOT_FOUND_MANUAL_REVIEW");
		} catch (error) {
			this.logger.error({ err: error, jobId: job.id }, "Migration worker failed");
		} finally {
			this.running = false;
			this.leases.release("migration");
		}
	}

	private applyUnregistered(userId: string, username: string, joinedAt: number, jobId: string, nickname: string | null, actorId: string): void {
		this.registrations.upsertJoined(this.config.DISCORD_GUILD_ID, userId, username, joinedAt);
		this.registrations.unregister(this.config.DISCORD_GUILD_ID, userId, actorId, Date.now());
	}

	private applyVerifiedWithoutRiot(
		item: { guildId: string; userId: string; jobId: string; parsedDisplayName: string | null; originalNickname: string | null },
		discordUsername: string,
		joinedAt: number,
		actorUserId: string,
		reason: "LEGACY_NO_RIOT" | "RIOT_NOT_FOUND"
	): void {
		this.registrations.upsertJoined(item.guildId, item.userId, discordUsername, joinedAt);
		this.registrations.saveVerifiedWithoutRiot({
			guildId: item.guildId,
			userId: item.userId,
			actorUserId,
			discordUsername,
			displayName: item.parsedDisplayName!,
			migrationJobId: item.jobId,
			originalNickname: item.originalNickname,
			reason,
		});
	}
}
