import type { GuildMember } from "discord.js";
import type { Logger } from "pino";
import type { RegistrationRepository } from "../repositories/mongo/registration-repository.js";
import type { MemberReconciliationService } from "../integrations/discord/member-reconciliation-service.js";
import type { AuditRepository } from "../repositories/mongo/audit-repository.js";
import type { Localizer } from "../localization/formatter.js";

export function createGuildMemberAddHandler(
	registrations: RegistrationRepository,
	reconciliation: MemberReconciliationService,
	audits: AuditRepository,
	logger: Logger,
	i18n?: Localizer,
	joinEngagementEnabled = false
) {
	return async (member: GuildMember): Promise<void> => {
		if (member.user.bot) return;
		try {
			const registration = await registrations.upsertJoined(member.guild.id, member.id, member.user.username, member.joinedTimestamp ?? Date.now());
			await audits.create({
				guildId: member.guild.id,
				targetUserId: member.id,
				action: "MEMBER_JOINED",
				result: "SUCCESS",
			});
			await reconciliation.reconcile(member.guild.id, member.id);
			if (joinEngagementEnabled && i18n && registration.status === "UNREGISTERED")
				await member
					.send(i18n.t("league.joinDm", { server: member.guild.name }))
					.catch((error: unknown) => logger.info({ err: error, guildId: member.guild.id, userId: member.id }, "Join engagement DM could not be delivered"));
		} catch (error) {
			logger.error({ err: error, guildId: member.guild.id, userId: member.id }, "Guild member add processing failed");
		}
	};
}
