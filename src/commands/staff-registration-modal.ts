import {
	ActionRowBuilder,
	ApplicationCommandType,
	ContextMenuCommandBuilder,
	MessageFlags,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	type GuildMember,
	type ModalSubmitInteraction,
	type UserContextMenuCommandInteraction,
} from "discord.js";
import type { AppConfig } from "../config/schema.js";
import type { MemberReconciliationService } from "../integrations/discord/member-reconciliation-service.js";
import type { Localizer } from "../localization/formatter.js";
import type { PermissionService } from "../services/permission-service.js";
import type { RegistrationResult, RegistrationService } from "../services/registration-service.js";
import { operationPriorities } from "../types/domain.js";

const COMMAND_NAME_KEY = "command.contextRegister.name" as const;
const MODAL_PREFIX = "staff-register";

interface StaffRegistrationModalContext {
	config: AppConfig;
	i18n: Localizer;
	permissions: PermissionService;
	registrationService: RegistrationService;
	reconciliation: MemberReconciliationService;
}

export function staffRegistrationContextCommand(i18n: Localizer): ContextMenuCommandBuilder {
	return new ContextMenuCommandBuilder().setName(i18n.t(COMMAND_NAME_KEY)).setType(ApplicationCommandType.User);
}

export async function showStaffRegistrationModal(interaction: UserContextMenuCommandInteraction, ctx: StaffRegistrationModalContext): Promise<void> {
	if (interaction.guildId !== ctx.config.DISCORD_GUILD_ID || !interaction.guild) {
		await interaction.reply({ content: ctx.i18n.t("registration.notInGuild"), flags: MessageFlags.Ephemeral });
		return;
	}
	const actor = await interaction.guild.members.fetch(interaction.user.id);
	if (!ctx.permissions.isStaff(actor) && !ctx.permissions.isAdministrator(actor)) {
		await interaction.reply({ content: ctx.i18n.t("permissions.denied"), flags: MessageFlags.Ephemeral });
		return;
	}
	let member: GuildMember;
	try {
		member = await interaction.guild.members.fetch(interaction.targetId);
	} catch {
		await interaction.reply({ content: ctx.i18n.t("permissions.memberNotManageable"), flags: MessageFlags.Ephemeral });
		return;
	}
	if (member.user.bot) {
		await interaction.reply({ content: ctx.i18n.t("registration.botNotAllowed"), flags: MessageFlags.Ephemeral });
		return;
	}
	if (!member.manageable) {
		await interaction.reply({ content: ctx.i18n.t("permissions.memberNotManageable"), flags: MessageFlags.Ephemeral });
		return;
	}

	const modal = new ModalBuilder()
		.setCustomId(`${MODAL_PREFIX}:${interaction.guildId}:${member.id}:${actor.id}`)
		.setTitle(ctx.i18n.t("modal.register.title"))
		.addComponents(
			row(
				new TextInputBuilder()
					.setCustomId("riot-account")
					.setLabel(ctx.i18n.t("modal.register.riotAccountLabel"))
					.setPlaceholder(ctx.i18n.t("modal.register.riotAccountPlaceholder"))
					.setStyle(TextInputStyle.Short)
					.setMaxLength(300)
					.setRequired(true)
			),
			row(
				new TextInputBuilder()
					.setCustomId("display-name")
					.setLabel(ctx.i18n.t("modal.register.nameLabel"))
					.setPlaceholder(ctx.i18n.t("modal.register.namePlaceholder"))
					.setStyle(TextInputStyle.Short)
					.setMaxLength(80)
					.setRequired(false)
			),
			row(
				new TextInputBuilder()
					.setCustomId("visibility")
					.setLabel(ctx.i18n.t("modal.register.visibilityLabel"))
					.setPlaceholder(ctx.i18n.t("modal.register.visibilityPlaceholder"))
					.setStyle(TextInputStyle.Short)
					.setValue(ctx.i18n.t("modal.register.visibilityDefault"))
					.setMaxLength(12)
					.setRequired(true)
			),
			row(
				new TextInputBuilder()
					.setCustomId("platform")
					.setLabel(ctx.i18n.t("modal.register.platformLabel"))
					.setPlaceholder(ctx.i18n.t("modal.register.platformPlaceholder"))
					.setStyle(TextInputStyle.Short)
					.setValue(ctx.config.DEFAULT_RIOT_PLATFORM_REGION)
					.setMaxLength(8)
					.setRequired(true)
			)
		);
	await interaction.showModal(modal);
}

export function isStaffRegistrationModal(interaction: ModalSubmitInteraction): boolean {
	return interaction.customId.startsWith(`${MODAL_PREFIX}:`);
}

export async function handleStaffRegistrationModal(interaction: ModalSubmitInteraction, ctx: StaffRegistrationModalContext): Promise<void> {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	const [, guildId, userId, actorId] = interaction.customId.split(":");
	if (!guildId || !userId || !actorId || guildId !== interaction.guildId || actorId !== interaction.user.id || guildId !== ctx.config.DISCORD_GUILD_ID || !interaction.guild) {
		await interaction.editReply(ctx.i18n.t("permissions.denied"));
		return;
	}
	const actor = await interaction.guild.members.fetch(actorId);
	if (!ctx.permissions.isStaff(actor) && !ctx.permissions.isAdministrator(actor)) {
		await interaction.editReply(ctx.i18n.t("permissions.denied"));
		return;
	}
	let member: GuildMember;
	try {
		member = await interaction.guild.members.fetch(userId);
	} catch {
		await interaction.editReply(ctx.i18n.t("permissions.memberNotManageable"));
		return;
	}
	if (member.user.bot || !member.manageable) {
		await interaction.editReply(ctx.i18n.t(member.user.bot ? "registration.botNotAllowed" : "permissions.memberNotManageable"));
		return;
	}
	const visibility = parseVisibility(interaction.fields.getTextInputValue("visibility"));
	if (!visibility) {
		await interaction.editReply(ctx.i18n.t("registration.invalidVisibility"));
		return;
	}
	const account = interaction.fields.getTextInputValue("riot-account").trim();
	const name = interaction.fields.getTextInputValue("display-name").trim() || null;
	const common = {
		guildId,
		userId,
		actorUserId: actorId,
		discordUsername: member.user.username,
		name,
		hideName: visibility === "HIDDEN",
		overrideDuplicate: ctx.permissions.isAdministrator(actor),
		overrideAuthorized: ctx.permissions.isAdministrator(actor),
		priority: operationPriorities.STAFF,
	};
	const result = /^https?:\/\//i.test(account)
		? await ctx.registrationService.register({ ...common, opgg: account })
		: await ctx.registrationService.registerRiotId({ ...common, riotId: account, platform: interaction.fields.getTextInputValue("platform") });
	await sendResult(interaction, result, userId, ctx);
}

function row(input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> {
	return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function parseVisibility(value: string): "VISIBLE" | "HIDDEN" | null {
	const normalized = value.trim().toLocaleLowerCase("de-DE");
	if (["sichtbar", "visible", "öffentlich", "oeffentlich"].includes(normalized)) return "VISIBLE";
	if (["privat", "verborgen", "hidden"].includes(normalized)) return "HIDDEN";
	return null;
}

function resultKey(result: Exclude<RegistrationResult, { kind: "success" }>, administrator: boolean): Parameters<Localizer["t"]>[0] {
	if (result.kind === "duplicate-puuid" && !administrator) return "registration.duplicateRequiresAdministrator";
	return {
		"invalid-opgg": "registration.invalidOpggUrl",
		"invalid-riot-id": "registration.invalidRiotId",
		"invalid-platform": "registration.invalidPlatform",
		"name-required": "registration.nameRequired",
		"name-not-allowed": "registration.nameNotAllowedWhenHidden",
		"riot-not-found": "registration.riotAccountNotFound",
		"riot-unavailable": "registration.riotUnavailable",
		"duplicate-puuid": "registration.duplicatePuuid",
	}[result.kind] as Parameters<Localizer["t"]>[0];
}

async function sendResult(
	interaction: ModalSubmitInteraction,
	result: RegistrationResult,
	userId: string,
	ctx: StaffRegistrationModalContext
): Promise<void> {
	if (result.kind !== "success") {
		const actor = await interaction.guild!.members.fetch(interaction.user.id);
		await interaction.editReply(ctx.i18n.t(resultKey(result, ctx.permissions.isAdministrator(actor))));
		return;
	}
	const sync = await ctx.reconciliation.reconcile(interaction.guildId!, userId);
	await interaction.editReply(
		ctx.i18n.t(sync.kind === "success" || sync.kind === "no-op" ? "registration.staffModalSuccess" : "registration.discordSyncPending")
	);
}
