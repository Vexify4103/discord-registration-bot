import type { Client } from "discord.js";
import type { Logger } from "pino";
import type { AppConfig } from "../config/schema.js";
import { DiscordMemberMutationQueue } from "../queues/discord-member-mutation-queue.js";
import { RegistrationRepository } from "../repositories/registration-repository.js";
import { PermissionService } from "../services/permission-service.js";
import { Localizer } from "../localization/formatter.js";
import { WorkerLeaseRepository } from "../repositories/worker-lease-repository.js";
import { AuditRepository } from "../repositories/audit-repository.js";

export class CleanupWorker {
	private timer?: NodeJS.Timeout;
	private running = false;
	constructor(
		private readonly client: Client,
		private readonly config: AppConfig,
		private readonly registrations: RegistrationRepository,
		private readonly permissions: PermissionService,
		private readonly queue: DiscordMemberMutationQueue,
		private readonly i18n: Localizer,
		private readonly leases: WorkerLeaseRepository,
		private readonly audits: AuditRepository,
		private readonly logger: Logger
	) {}
	start(): void {
		this.timer = setInterval(() => void this.tick(), this.config.REGISTRATION_CLEANUP_INTERVAL_MINUTES * 60_000);
		void this.tick();
	}
	stop(): void {
		if (this.timer) clearInterval(this.timer);
	}
	async tick(): Promise<void> {
		if (this.running || !this.leases.acquire("cleanup", 10 * 60_000)) return;
		this.running = true;
		try {
			const cutoff = Date.now() - this.config.REGISTRATION_EXPIRY_DAYS * 86_400_000;
			for (const row of this.registrations.dueCleanup(cutoff))
				await this.queue.run(`${row.guildId}:${row.userId}`, 70, async () => {
					const current = this.registrations.get(row.guildId, row.userId);
					if (!current || current.status !== "UNREGISTERED" || current.stateVersion !== row.stateVersion || this.registrations.hasActiveAttempt(row.guildId, row.userId))
						return;
					const guild = await this.client.guilds.fetch(row.guildId);
					let member;
					try {
						member = await guild.members.fetch(row.userId);
					} catch {
						return;
					}
					if (member.user.bot || member.id === guild.ownerId || this.permissions.isExempt(member) || !member.manageable) return;
					const final = this.registrations.get(row.guildId, row.userId);
					if (!final || final.status !== "UNREGISTERED" || final.stateVersion !== row.stateVersion || this.registrations.hasActiveAttempt(row.guildId, row.userId))
						return;
					this.audits.create({
						guildId: row.guildId,
						targetUserId: row.userId,
						action: "CLEANUP_KICK_ATTEMPTED",
						result: "STARTED",
					});
					if (this.config.SEND_DM_BEFORE_KICK)
						try {
							await member.send(this.i18n.t("cleanup.removalDm"));
						} catch (error) {
							this.logger.info({ err: error, userId: row.userId }, "Cleanup DM failed");
						}
					const afterDm = this.registrations.get(row.guildId, row.userId);
					if (!afterDm || afterDm.status !== "UNREGISTERED" || afterDm.stateVersion !== row.stateVersion || this.registrations.hasActiveAttempt(row.guildId, row.userId))
						return;
					try {
						await member.kick(this.i18n.t("cleanup.removalReason"));
						this.registrations.markLeft(row.guildId, row.userId);
						this.audits.create({
							guildId: row.guildId,
							targetUserId: row.userId,
							action: "CLEANUP_KICK_SUCCEEDED",
							result: "SUCCESS",
						});
					} catch (error) {
						this.audits.create({
							guildId: row.guildId,
							targetUserId: row.userId,
							action: "CLEANUP_KICK_FAILED",
							result: "FAILED",
							metadata: { errorCode: "DISCORD_KICK_FAILED" },
						});
						throw error;
					}
				});
		} catch (error) {
			this.logger.error({ err: error }, "Cleanup worker failed");
		} finally {
			this.running = false;
			this.leases.release("cleanup");
		}
	}
}
