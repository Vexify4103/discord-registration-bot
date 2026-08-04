import type { GuildMember, PartialGuildMember } from "discord.js";
import type { Logger } from "pino";
import type { RegistrationRepository } from "../repositories/mongo/registration-repository.js";
import type { AuditRepository } from "../repositories/mongo/audit-repository.js";

export function createGuildMemberRemoveHandler(registrations: RegistrationRepository, audits: AuditRepository, logger: Logger) {
	return async (member: GuildMember | PartialGuildMember): Promise<void> => {
		if (member.user.bot) return;
		try {
			await registrations.markLeft(member.guild.id, member.id);
			await audits.create({
				guildId: member.guild.id,
				targetUserId: member.id,
				action: "MEMBER_LEFT",
				result: "SUCCESS",
			});
		} catch (error) {
			logger.error({ err: error, guildId: member.guild.id, userId: member.id }, "Guild member remove processing failed");
		}
	};
}
