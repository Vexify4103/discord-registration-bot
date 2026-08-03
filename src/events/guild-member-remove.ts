import type { GuildMember, PartialGuildMember } from "discord.js";
import type { Logger } from "pino";
import type { RegistrationRepository } from "../repositories/registration-repository.js";
import type { AuditRepository } from "../repositories/audit-repository.js";

export function createGuildMemberRemoveHandler(registrations: RegistrationRepository, audits: AuditRepository, logger: Logger) {
	return (member: GuildMember | PartialGuildMember): void => {
		if (member.user.bot) return;
		try {
			registrations.markLeft(member.guild.id, member.id);
			audits.create({
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
