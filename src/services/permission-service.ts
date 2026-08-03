import { PermissionFlagsBits, type GuildMember } from "discord.js";
import type { AppConfig } from "../config/schema.js";

export class PermissionService {
	constructor(private readonly config: AppConfig) {}

	isStaff(member: GuildMember): boolean {
		return member.id === member.guild.ownerId || member.roles.cache.some((role) => this.config.STAFF_ROLE_IDS.includes(role.id));
	}

	isAdministrator(member: GuildMember): boolean {
		return member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator);
	}

	isExempt(member: GuildMember): boolean {
		return (
			member.id === member.guild.ownerId ||
			this.config.EXEMPT_USER_IDS.includes(member.id) ||
			member.roles.cache.some((role) => this.config.EXEMPT_ROLE_IDS.includes(role.id))
		);
	}
}
