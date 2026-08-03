import type { GuildMember } from "discord.js";
import type { Logger } from "pino";
import type { RegistrationRepository } from "../repositories/registration-repository.js";
import type { MemberReconciliationService } from "../integrations/discord/member-reconciliation-service.js";
import type { AuditRepository } from "../repositories/audit-repository.js";

export function createGuildMemberAddHandler(registrations: RegistrationRepository, reconciliation: MemberReconciliationService, audits: AuditRepository, logger: Logger) {
	return async (member: GuildMember): Promise<void> => {
		if (member.user.bot) return;
		try {
			registrations.upsertJoined(member.guild.id, member.id, member.user.username, member.joinedTimestamp ?? Date.now());
			audits.create({
				guildId: member.guild.id,
				targetUserId: member.id,
				action: "MEMBER_JOINED",
				result: "SUCCESS",
			});
			await reconciliation.reconcile(member.guild.id, member.id);
		} catch (error) {
			logger.error({ err: error, guildId: member.guild.id, userId: member.id }, "Guild member add processing failed");
		}
	};
}
