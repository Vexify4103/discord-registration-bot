import type { Logger } from "pino";
import type { AppConfig } from "../config/schema.js";
import { RiotLeagueService } from "../integrations/riot/riot-league-service.js";
import { LeagueRepository } from "../repositories/league-repository.js";
import { RegistrationRepository } from "../repositories/registration-repository.js";
import { WorkerLeaseRepository } from "../repositories/worker-lease-repository.js";
import { operationPriorities } from "../types/domain.js";

export class LeagueStatsWorker {
	private timer?: NodeJS.Timeout;
	private running = false;
	constructor(
		private readonly config: AppConfig,
		private readonly league: LeagueRepository,
		private readonly registrations: RegistrationRepository,
		private readonly riot: RiotLeagueService,
		private readonly leases: WorkerLeaseRepository,
		private readonly logger: Logger
	) {}

	start(): void {
		if (!this.config.LEAGUE_STATS_ENABLED || !this.config.RIOT_API_KEY) return;
		this.timer = setInterval(() => void this.tick(), this.config.LEAGUE_STATS_WORKER_INTERVAL_MINUTES * 60_000);
		void this.tick();
	}
	stop(): void {
		if (this.timer) clearInterval(this.timer);
	}

	async tick(): Promise<void> {
		if (this.running || !this.leases.acquire("league-stats", 15 * 60_000)) return;
		this.running = true;
		try {
			const due = this.league.due(Date.now(), this.config.LEAGUE_STATS_BATCH_SIZE);
			if (!due.length) return;
			let succeeded = 0;
			for (const registration of due) if (await this.syncRegistration(registration.guildId, registration.userId, 35)) succeeded++;
			this.logger.info({ batchSize: due.length, succeeded, failed: due.length - succeeded }, "League stats synchronization batch completed");
		} catch (error) {
			this.logger.error({ err: error }, "League stats worker failed");
		} finally {
			this.running = false;
			this.leases.release("league-stats");
		}
	}

	async syncOne(guildId: string, userId: string): Promise<boolean> {
		return this.syncRegistration(guildId, userId, 70);
	}

	private async syncRegistration(guildId: string, userId: string, priority: number): Promise<boolean> {
		const registration = this.registrations.get(guildId, userId);
		if (!registration?.puuid || !registration.platformRegion || registration.status !== "REGISTERED") return false;
		const result = await this.riot.stats(registration.platformRegion, registration.puuid, priority);
		const now = Date.now();
		if (result.kind !== "success") {
			this.league.fail(guildId, userId, result.code, now + 60 * 60_000, now);
			return false;
		}
		const next = now + this.config.LEAGUE_STATS_SYNC_INTERVAL_HOURS * 60 * 60_000 + deterministicJitter(userId);
		this.league.save(guildId, userId, { ...result, puuid: registration.puuid }, next, now);
		if (this.config.RANK_ROLE_SYNC_ENABLED) this.registrations.requestReconciliation(guildId, userId, operationPriorities.RIOT_SYNC, now);
		return true;
	}
}

function deterministicJitter(userId: string): number {
	let value = 0;
	for (const char of userId) value = (value * 31 + char.charCodeAt(0)) >>> 0;
	return value % (60 * 60_000);
}
