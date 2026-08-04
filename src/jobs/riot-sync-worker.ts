import type { Logger } from "pino";
import type { AppConfig } from "../config/schema.js";
import { RiotAccountService } from "../integrations/riot/riot-account-service.js";
import { RegistrationRepository } from "../repositories/mongo/registration-repository.js";
import { WorkerLeaseRepository } from "../repositories/mongo/worker-lease-repository.js";

export class RiotSyncWorker {
	private timer?: NodeJS.Timeout;
	private running = false;
	constructor(
		private readonly config: AppConfig,
		private readonly registrations: RegistrationRepository,
		private readonly riot: RiotAccountService,
		private readonly leases: WorkerLeaseRepository,
		private readonly logger: Logger
	) {}
	start(): void {
		if (!this.config.RIOT_SYNC_ENABLED || !this.config.RIOT_API_KEY) return;
		this.timer = setInterval(() => void this.tick(), this.config.RIOT_SYNC_WORKER_INTERVAL_MINUTES * 60_000);
		void this.tick();
	}
	stop(): void {
		if (this.timer) clearInterval(this.timer);
	}
	async tick(): Promise<void> {
		if (this.running || !(await this.leases.acquire("riot-sync", 10 * 60_000))) return;
		this.running = true;
		try {
			for (const row of await this.registrations.dueRiotSync(Date.now(), this.config.RIOT_SYNC_BATCH_SIZE)) {
				if (!row.puuid || !row.accountRoutingGroup) continue;
				const result = await this.riot.byPuuid(row.accountRoutingGroup, row.puuid, 40);
				if (result.kind === "success")
					await this.registrations.updateCanonicalRiotIdentity(
						row,
						result.account.gameName,
						result.account.tagLine,
						Date.now() + this.config.RIOT_SYNC_INTERVAL_DAYS * 86_400_000
					);
				else
					await this.registrations.updateSync(row.guildId, row.userId, {
						riotSyncStatus: result.kind === "authentication-failure" ? "FAILED_PERMANENT" : "FAILED_RETRYABLE",
						riotSyncFailureCount: row.riotSyncFailureCount + 1,
						lastRiotSyncErrorCode: result.kind,
						nextRiotSyncAt: Date.now() + Math.min(86_400_000, 2 ** row.riotSyncFailureCount * 60_000),
					});
			}
		} catch (error) {
			this.logger.error({ err: error }, "Riot sync worker failed");
		} finally {
			this.running = false;
			await this.leases.release("riot-sync");
		}
	}

	async syncOne(guildId: string, userId: string): Promise<boolean> {
		const row = await this.registrations.get(guildId, userId);
		if (!row?.puuid || !row.accountRoutingGroup || row.status !== "REGISTERED") return false;
		const result = await this.riot.byPuuid(row.accountRoutingGroup, row.puuid, 60);
		if (result.kind !== "success") return false;
		await this.registrations.updateCanonicalRiotIdentity(row, result.account.gameName, result.account.tagLine, Date.now() + this.config.RIOT_SYNC_INTERVAL_DAYS * 86_400_000);
		return true;
	}
}
