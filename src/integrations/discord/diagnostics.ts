import { GatewayIntentBits, PermissionFlagsBits, type Client, type Guild } from "discord.js";
import type { AppConfig } from "../../config/schema.js";
import { Localizer } from "../../localization/formatter.js";

export interface DiagnosticResult {
	errors: string[];
	warnings: string[];
}

export async function diagnoseGuild(client: Client, guild: Guild, config: AppConfig, i18n: Localizer): Promise<DiagnosticResult> {
	const errors: string[] = [];
	const warnings: string[] = [];
	const named = guild.roles.cache.get(config.VERIFIED_NAMED_ROLE_ID);
	const privateRole = guild.roles.cache.get(config.VERIFIED_PRIVATE_ROLE_ID);
	const unregistered = guild.roles.cache.get(config.UNREGISTERED_ROLE_ID);
	for (const [label, role] of [
		["Verifiziert", named],
		["Verifiziert | Privat", privateRole],
		["Unregistriert", unregistered],
	] as const) {
		if (!role) errors.push(i18n.t("permissions.roleMissing", { role: label }));
	}
	const me = guild.members.me ?? (await guild.members.fetchMe());
	if (!client.options.intents.has(GatewayIntentBits.GuildMembers)) errors.push(i18n.t("permissions.intentMissing"));
	const required = [
		PermissionFlagsBits.ViewChannel,
		PermissionFlagsBits.SendMessages,
		PermissionFlagsBits.ManageNicknames,
		PermissionFlagsBits.ManageRoles,
		PermissionFlagsBits.KickMembers,
	];
	if (!me.permissions.has(required)) errors.push(i18n.t("permissions.denied"));
	if (named && privateRole && unregistered) {
		if (me.roles.highest.comparePositionTo(named) <= 0 || me.roles.highest.comparePositionTo(privateRole) <= 0 || me.roles.highest.comparePositionTo(unregistered) <= 0)
			errors.push(
				i18n.t("permissions.roleOrder", {
					detail: "Die Bot-Rolle muss über allen Registrierungsrollen liegen.",
				})
			);
		if (!(named.position > privateRole.position && privateRole.position > unregistered.position))
			errors.push(
				i18n.t("permissions.roleOrder", {
					detail: "Verifiziert muss über Verifiziert | Privat und diese Rolle über Unregistriert liegen.",
				})
			);
		if (!named.hoist) warnings.push(i18n.t("permissions.roleHoist", { role: named.name }));
		if (!privateRole.hoist) warnings.push(i18n.t("permissions.roleHoist", { role: privateRole.name }));
		if (unregistered.hoist) warnings.push(i18n.t("permissions.roleHoist", { role: unregistered.name }));
		for (const role of [named, privateRole])
			if (role.mentionable !== config.VERIFIED_ROLES_MENTIONABLE) warnings.push(i18n.t("permissions.roleMentionable", { role: role.name }));
		for (const role of [named, privateRole, unregistered])
			if (role.permissions.has(PermissionFlagsBits.Administrator)) errors.push(i18n.t("permissions.roleAdministrator", { role: role.name }));
		for (const staffRoleId of config.STAFF_ROLE_IDS) {
			const staffRole = guild.roles.cache.get(staffRoleId);
			if (!staffRole) {
				errors.push(i18n.t("permissions.roleMissing", { role: `Staff (${staffRoleId})` }));
				continue;
			}
			if (staffRole.position <= named.position)
				warnings.push(
					i18n.t("permissions.roleOrder", {
						detail: `Die Staff-Rolle „${staffRole.name}“ sollte über „${named.name}“ liegen.`,
					})
				);
			if (me.roles.highest.comparePositionTo(staffRole) <= 0)
				warnings.push(
					i18n.t("permissions.roleOrder", {
						detail: `Mitglieder der Staff-Rolle „${staffRole.name}“ sind für den Bot möglicherweise nicht verwaltbar.`,
					})
				);
		}
	}
	return { errors, warnings };
}
