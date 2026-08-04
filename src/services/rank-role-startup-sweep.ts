import type { Collection, GuildMember, Snowflake } from "discord.js";
import type { Logger } from "pino";
import type { Registration } from "../database/schema/index.js";
import { operationPriorities } from "../types/domain.js";

type MaybePromise<T> = T | Promise<T>;

interface RankRoleRegistrationStore {
	get(guildId: string, userId: string): MaybePromise<Registration | undefined>;
	upsertJoined(guildId: string, userId: string, username: string, joinedAt: number): MaybePromise<Registration>;
	requestReconciliation(guildId: string, userId: string, priority: number): MaybePromise<boolean>;
}

export interface RankRoleSweepSummary {
	totalMembers: number;
	botsIgnored: number;
	registeredQueued: number;
	cleanupQueued: number;
	pendingPreserved: number;
}

export class RankRoleStartupSweep {
	constructor(
		private readonly registrations: RankRoleRegistrationStore,
		private readonly logger: Logger
	) {}

	async run(guildId: string, members: Collection<Snowflake, GuildMember>): Promise<RankRoleSweepSummary> {
		const summary: RankRoleSweepSummary = {
			totalMembers: members.size,
			botsIgnored: 0,
			registeredQueued: 0,
			cleanupQueued: 0,
			pendingPreserved: 0,
		};
		let examinedHumans = 0;
		for (const member of members.values()) {
			if (member.user.bot) {
				summary.botsIgnored++;
				continue;
			}
			examinedHumans++;
			let registration = await this.registrations.get(guildId, member.id);
			if (!registration || !registration.isPresent)
				registration = await this.registrations.upsertJoined(guildId, member.id, member.user.username, member.joinedTimestamp ?? Date.now());
			if (registration.status === "PENDING_VERIFICATION") {
				summary.pendingPreserved++;
				continue;
			}
			await this.registrations.requestReconciliation(guildId, member.id, operationPriorities.REPAIR);
			if (registration.status === "REGISTERED" && registration.puuid) summary.registeredQueued++;
			else summary.cleanupQueued++;
			if (examinedHumans % 100 === 0)
				this.logger.info(
					{ guildId, examinedHumans, totalMembers: members.size, registeredQueued: summary.registeredQueued, cleanupQueued: summary.cleanupQueued },
					"Rank role startup sweep progress"
				);
		}
		this.logger.info({ guildId, ...summary }, "Rank role startup sweep queued");
		return summary;
	}
}
