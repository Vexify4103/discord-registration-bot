import { DiscordAPIError, type Client, type GuildMember } from "discord.js";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/schema.js";
import type { RegistrationRepository } from "../../repositories/registration-repository.js";
import type { PlannedDiscordOperation } from "../../services/member-state-reconciler.js";
import { MemberStateReconciler } from "../../services/member-state-reconciler.js";
import { AuditRepository } from "../../repositories/audit-repository.js";
import { Localizer } from "../../localization/formatter.js";
import { LeagueRepository } from "../../repositories/league-repository.js";

export type DiscordMutationResult = { kind: "success" | "no-op" } | { kind: "retryable" | "permanent"; code: string };

export class MemberReconciliationService {
	constructor(
		private readonly client: Client,
		private readonly config: AppConfig,
		private readonly registrations: RegistrationRepository,
		private readonly league: LeagueRepository,
		private readonly reconciler: MemberStateReconciler,
		private readonly audits: AuditRepository,
		private readonly i18n: Localizer,
		private readonly logger: Logger
	) {}

	async reconcile(guildId: string, userId: string): Promise<DiscordMutationResult> {
		const registration = this.registrations.get(guildId, userId);
		if (!registration || !registration.isPresent) return { kind: "permanent", code: "REGISTRATION_OR_MEMBER_ABSENT" };
		try {
			const guild = await this.client.guilds.fetch(guildId);
			const member = await guild.members.fetch(userId);
			const leagueProfile = this.league.profile(guildId, userId);
			const plan = this.reconciler.plan(
				registration,
				{
					userId,
					username: member.user.username,
					nickname: member.nickname,
					roleIds: new Set(member.roles.cache.keys()),
					manageable: member.manageable && userId !== guild.ownerId && !member.user.bot,
				},
				leagueProfile?.puuidSnapshot === registration.puuid && leagueProfile.lastStatsSyncAt ? leagueProfile.effectiveTier : undefined
			);
			if (!plan.manageable) return { kind: "permanent", code: "MEMBER_NOT_MANAGEABLE" };
			if (!plan.operations.length) return { kind: "no-op" };
			let rolesChanged = false;
			let nicknameChanged = false;
			for (const operation of plan.operations) {
				const result = await this.execute(member, operation);
				this.audits.create({
					guildId,
					targetUserId: userId,
					action: operation.type,
					result: result.kind.toUpperCase(),
					metadata: {
						...(operation.type.includes("ROLE") && operation.value ? { roleId: operation.value } : {}),
						...("code" in result ? { errorCode: result.code } : {}),
					},
				});
				if (result.kind !== "success" && result.kind !== "no-op") return result;
				rolesChanged ||= operation.type.includes("ROLE");
				nicknameChanged ||= operation.type === "SET_NICKNAME";
			}
			const now = Date.now();
			this.registrations.updateSync(guildId, userId, {
				...(rolesChanged ? { roleSyncStatus: "SUCCEEDED" as const, lastRoleSyncAt: now } : {}),
				...(nicknameChanged
					? {
							nicknameSyncStatus: "SUCCEEDED" as const,
							lastNicknameSyncAt: now,
						}
					: {}),
			});
			return { kind: "success" };
		} catch (error) {
			const result = classifyDiscordError(error);
			this.logger.warn({ err: error, guildId, userId, errorCode: result.code }, "Discord reconciliation failed");
			return result;
		}
	}

	private async execute(member: GuildMember, operation: PlannedDiscordOperation): Promise<DiscordMutationResult> {
		const roleMap = {
			ADD_VERIFIED_NAMED_ROLE: this.config.VERIFIED_NAMED_ROLE_ID,
			REMOVE_VERIFIED_NAMED_ROLE: this.config.VERIFIED_NAMED_ROLE_ID,
			ADD_VERIFIED_PRIVATE_ROLE: this.config.VERIFIED_PRIVATE_ROLE_ID,
			REMOVE_VERIFIED_PRIVATE_ROLE: this.config.VERIFIED_PRIVATE_ROLE_ID,
			ADD_UNREGISTERED_ROLE: this.config.UNREGISTERED_ROLE_ID,
			REMOVE_UNREGISTERED_ROLE: this.config.UNREGISTERED_ROLE_ID,
		} as const;
		try {
			if (operation.type === "SET_NICKNAME") {
				if (member.nickname === operation.value) return { kind: "no-op" };
				await member.setNickname(operation.value!, this.i18n.t("audit.reconciliationReason"));
			} else if (operation.type === "ADD_RANK_ROLE" || operation.type === "REMOVE_RANK_ROLE") {
				if (!operation.value || !configuredRankRoleIds(this.config).has(operation.value)) return { kind: "permanent", code: "INVALID_RANK_ROLE" };
				const add = operation.type === "ADD_RANK_ROLE";
				if (add === member.roles.cache.has(operation.value)) return { kind: "no-op" };
				if (add) await member.roles.add(operation.value, this.i18n.t("audit.rankReconciliationReason"));
				else await member.roles.remove(operation.value, this.i18n.t("audit.rankReconciliationReason"));
			} else if (operation.type in roleMap) {
				const roleId = roleMap[operation.type as keyof typeof roleMap];
				const add = operation.type.startsWith("ADD_");
				if (add === member.roles.cache.has(roleId)) return { kind: "no-op" };
				if (add) await member.roles.add(roleId, this.i18n.t("audit.reconciliationReason"));
				else await member.roles.remove(roleId, this.i18n.t("audit.reconciliationReason"));
			}
			return { kind: "success" };
		} catch (error) {
			return classifyDiscordError(error);
		}
	}
}

function configuredRankRoleIds(config: AppConfig): ReadonlySet<string> {
	return new Set(
		[
			config.RANK_ROLE_UNRANKED_ID,
			config.RANK_ROLE_IRON_ID,
			config.RANK_ROLE_BRONZE_ID,
			config.RANK_ROLE_SILVER_ID,
			config.RANK_ROLE_GOLD_ID,
			config.RANK_ROLE_PLATINUM_ID,
			config.RANK_ROLE_EMERALD_ID,
			config.RANK_ROLE_DIAMOND_ID,
			config.RANK_ROLE_MASTER_ID,
			config.RANK_ROLE_GRANDMASTER_ID,
			config.RANK_ROLE_CHALLENGER_ID,
		].filter((id): id is string => Boolean(id))
	);
}

export function classifyDiscordError(error: unknown): {
	kind: "retryable" | "permanent";
	code: string;
} {
	if (error instanceof DiscordAPIError) {
		const permanentCodes = new Set([50001, 50013, 10007, 10011, 50035]);
		if (permanentCodes.has(Number(error.code)) || error.status === 403 || error.status === 404) return { kind: "permanent", code: `DISCORD_${error.code}` };
		if (error.status === 429 || error.status >= 500) return { kind: "retryable", code: `DISCORD_HTTP_${error.status}` };
	}
	return { kind: "retryable", code: "DISCORD_NETWORK_OR_UNKNOWN" };
}
