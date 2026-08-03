import { SlashCommandBuilder } from "discord.js";
import { Localizer } from "../localization/formatter.js";

export function commandDefinitions(i18n: Localizer) {
	const memberCommand = (name: string, descriptionKey: Parameters<Localizer["t"]>[0]) =>
		new SlashCommandBuilder()
			.setName(name)
			.setDescription(i18n.t(descriptionKey))
			.addUserOption((o) => o.setName("member").setDescription(i18n.t("command.member")).setRequired(true));
	return [
		new SlashCommandBuilder()
			.setName("register")
			.setDescription(i18n.t("command.register.description"))
			.addStringOption((o) => o.setName("opgg").setDescription(i18n.t("command.register.opgg")).setRequired(true).setMaxLength(300))
			.addStringOption((o) => o.setName("name").setDescription(i18n.t("command.register.name")).setMaxLength(80))
			.addBooleanOption((o) => o.setName("hide-name").setDescription(i18n.t("command.register.hideName"))),
		new SlashCommandBuilder()
			.setName("register-user")
			.setDescription(i18n.t("command.registerUser.description"))
			.addUserOption((o) => o.setName("member").setDescription(i18n.t("command.member")).setRequired(true))
			.addStringOption((o) => o.setName("opgg").setDescription(i18n.t("command.register.opgg")).setRequired(true).setMaxLength(300))
			.addBooleanOption((o) => o.setName("hide-name").setDescription(i18n.t("command.register.hideName")).setRequired(true))
			.addStringOption((o) => o.setName("name").setDescription(i18n.t("command.register.name")).setMaxLength(80))
			.addBooleanOption((o) => o.setName("override-duplicate").setDescription(i18n.t("command.registerUser.overrideDuplicate"))),
		memberCommand("unregister", "command.unregister.description"),
		memberCommand("registration-info", "command.info.description"),
		memberCommand("sync-nickname", "command.syncNickname.description"),
		memberCommand("sync-riot-user", "command.syncRiot.description"),
		memberCommand("delete-registration-data", "command.delete.description"),
		memberCommand("registration-reconcile", "command.reconcile.description"),
		new SlashCommandBuilder()
			.setName("registration-setup")
			.setDescription(i18n.t("command.setup.description"))
			.addStringOption((o) =>
				o
					.setName("mode")
					.setDescription(i18n.t("command.setup.mode"))
					.setRequired(true)
					.addChoices(
						{ name: i18n.t("command.setup.preview"), value: "preview" },
						{ name: i18n.t("command.setup.apply"), value: "apply" },
						{ name: i18n.t("command.setup.pause"), value: "pause" },
						{ name: i18n.t("command.setup.resume"), value: "resume" },
						{ name: i18n.t("command.setup.status"), value: "status" }
					)
			),
	];
}
