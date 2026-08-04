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
						{ name: i18n.t("command.setup.cancel"), value: "cancel" },
						{ name: i18n.t("command.setup.unknown"), value: "unknown" },
						{ name: i18n.t("command.setup.manualReview"), value: "manual-review" },
						{ name: i18n.t("command.setup.resolveReview"), value: "resolve-review" },
						{ name: i18n.t("command.setup.status"), value: "status" }
					)
			),
		new SlashCommandBuilder()
			.setName("league")
			.setDescription(i18n.t("command.league.description"))
			.addSubcommand((s) =>
				s
					.setName("profile")
					.setDescription(i18n.t("command.league.profile"))
					.addUserOption((o) => o.setName("member").setDescription(i18n.t("command.league.member")))
			)
			.addSubcommand((s) =>
				s
					.setName("mastery")
					.setDescription(i18n.t("command.league.mastery"))
					.addUserOption((o) => o.setName("member").setDescription(i18n.t("command.league.member")))
			)
			.addSubcommand((s) =>
				s
					.setName("chart")
					.setDescription(i18n.t("command.league.chart"))
					.addStringOption((o) => o.setName("champion").setDescription(i18n.t("command.league.champion")).setRequired(true).setMaxLength(40))
					.addUserOption((o) => o.setName("member").setDescription(i18n.t("command.league.member")))
			)
			.addSubcommand((s) =>
				s
					.setName("top")
					.setDescription(i18n.t("command.league.top"))
					.addStringOption((o) =>
						o
							.setName("type")
							.setDescription(i18n.t("command.league.topType"))
							.setRequired(true)
							.addChoices({ name: i18n.t("command.league.topTotal"), value: "total" }, { name: i18n.t("command.league.topChampion"), value: "champion" })
					)
					.addStringOption((o) => o.setName("champion").setDescription(i18n.t("command.league.champion")).setMaxLength(40))
			)
			.addSubcommand((s) =>
				s
					.setName("refresh")
					.setDescription(i18n.t("command.league.refresh"))
					.addUserOption((o) => o.setName("member").setDescription(i18n.t("command.league.member")))
			)
			.addSubcommand((s) =>
				s
					.setName("roles")
					.setDescription(i18n.t("command.league.roles"))
					.addUserOption((o) => o.setName("member").setDescription(i18n.t("command.league.member")))
			)
			.addSubcommand((s) => s.setName("help").setDescription(i18n.t("command.league.help")))
			.addSubcommand((s) => s.setName("about").setDescription(i18n.t("command.league.about"))),
	];
}
