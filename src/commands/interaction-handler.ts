import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	GuildMember,
	MessageFlags,
	type ButtonInteraction,
	type Client,
	type Interaction,
} from "discord.js";
import type { Logger } from "pino";
import type { AppConfig } from "../config/schema.js";
import { MemberReconciliationService } from "../integrations/discord/member-reconciliation-service.js";
import { Localizer } from "../localization/formatter.js";
import { MigrationRepository } from "../repositories/migration-repository.js";
import { RegistrationRepository } from "../repositories/registration-repository.js";
import { MigrationService } from "../services/migration-service.js";
import { PermissionService } from "../services/permission-service.js";
import { RegistrationService, type RegistrationResult } from "../services/registration-service.js";
import { manualReviewMessage, migrationStatusMessage } from "../services/migration-status-presenter.js";
import { RiotSyncWorker } from "../jobs/riot-sync-worker.js";
import { diagnoseGuild } from "../integrations/discord/diagnostics.js";

export interface InteractionContext {
	client: Client;
	config: AppConfig;
	i18n: Localizer;
	logger: Logger;
	registrationService: RegistrationService;
	registrations: RegistrationRepository;
	reconciliation: MemberReconciliationService;
	permissions: PermissionService;
	migrationService: MigrationService;
	migrations: MigrationRepository;
	riotSync: RiotSyncWorker;
}

export async function handleInteraction(interaction: Interaction, context: InteractionContext): Promise<void> {
	try {
		if (interaction.isChatInputCommand()) await handleCommand(interaction, context);
		else if (interaction.isButton()) await handleButton(interaction, context);
	} catch (error) {
		context.logger.error({ err: error, interactionId: interaction.id }, "Interaction failed");
		if (interaction.isRepliable()) {
			const payload = {
				content: context.i18n.t("common.unexpectedError"),
				flags: MessageFlags.Ephemeral,
			} as const;
			if (interaction.deferred || interaction.replied) await interaction.editReply({ content: payload.content, components: [] }).catch(() => undefined);
			else await interaction.reply(payload).catch(() => undefined);
		}
	}
}

async function handleCommand(interaction: ChatInputCommandInteraction, ctx: InteractionContext): Promise<void> {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	if (interaction.guildId !== ctx.config.DISCORD_GUILD_ID || !interaction.guild) {
		await interaction.editReply(ctx.i18n.t("registration.notInGuild"));
		return;
	}
	const actor = await interaction.guild.members.fetch(interaction.user.id);
	if (interaction.commandName === "register") {
		const result = await ctx.registrationService.register({
			guildId: interaction.guildId,
			userId: actor.id,
			actorUserId: actor.id,
			discordUsername: actor.user.username,
			name: interaction.options.getString("name"),
			opgg: interaction.options.getString("opgg", true),
			hideName: interaction.options.getBoolean("hide-name") ?? false,
		});
		await registrationReply(interaction, result, actor.id, ctx);
		return;
	}
	if (!ctx.permissions.isStaff(actor)) {
		await interaction.editReply(ctx.i18n.t("permissions.denied"));
		return;
	}
	if (interaction.commandName === "registration-setup") {
		await handleSetup(interaction, actor, ctx);
		return;
	}
	const user = interaction.options.getUser("member", true);
	let member: GuildMember;
	try {
		member = await interaction.guild.members.fetch(user.id);
	} catch {
		await interaction.editReply(ctx.i18n.t("permissions.memberNotManageable"));
		return;
	}
	if (member.user.bot) {
		await interaction.editReply(ctx.i18n.t("registration.botNotAllowed"));
		return;
	}
	switch (interaction.commandName) {
		case "register-user": {
			const override = interaction.options.getBoolean("override-duplicate") ?? false;
			if (override && !ctx.permissions.isAdministrator(actor)) {
				await interaction.editReply(ctx.i18n.t("permissions.denied"));
				return;
			}
			const result = await ctx.registrationService.register({
				guildId: interaction.guildId,
				userId: member.id,
				actorUserId: actor.id,
				discordUsername: member.user.username,
				name: interaction.options.getString("name"),
				opgg: interaction.options.getString("opgg", true),
				hideName: interaction.options.getBoolean("hide-name", true),
				overrideDuplicate: override,
				overrideAuthorized: ctx.permissions.isAdministrator(actor),
			});
			await registrationReply(interaction, result, member.id, ctx);
			break;
		}
		case "unregister":
			ctx.registrations.unregister(interaction.guildId, member.id, actor.id);
			await ctx.reconciliation.reconcile(interaction.guildId, member.id);
			await interaction.editReply(ctx.i18n.t("registration.unregistered"));
			break;
		case "registration-info": {
			const row = ctx.registrations.get(interaction.guildId, member.id);
			if (!row) {
				await interaction.editReply(ctx.i18n.t("registration.notInGuild"));
				break;
			}
			const puuid = row.puuid ? `${row.puuid.slice(0, 6)}…${row.puuid.slice(-4)}` : "–";
			await interaction.editReply(
				`**${ctx.i18n.t("info.title")}**\n${ctx.i18n.t("info.body", {
					userId: row.userId,
					username: member.user.username,
					status: localizedRegistrationStatus(row.status, ctx.i18n),
					displayName: row.displayName ?? "–",
					visibility: localizedVisibility(row.nameVisibility, ctx.i18n),
					riotId: row.riotId ?? "–",
					puuid,
					platform: row.platformRegion ?? "–",
					registeredAt: ctx.i18n.date(row.registeredAt),
					unregisteredSince: ctx.i18n.date(row.unregisteredSince),
					lastSync: ctx.i18n.date(row.lastRiotSyncAt),
					nextSync: ctx.i18n.date(row.nextRiotSyncAt),
					roleSync: localizedSync(row.roleSyncStatus, ctx.i18n),
					nicknameSync: localizedSync(row.nicknameSyncStatus, ctx.i18n),
					migrationSource: row.migrationSource ? ctx.i18n.t("info.migrationLegacy") : "–",
					lastFailure: row.lastFailureCode || row.lastRiotSyncErrorCode ? ctx.i18n.t("info.failurePresent") : "–",
				})}`
			);
			break;
		}
		case "sync-nickname":
		case "registration-reconcile": {
			const result = await ctx.reconciliation.reconcile(interaction.guildId, member.id);
			await interaction.editReply(ctx.i18n.t(result.kind === "success" || result.kind === "no-op" ? "common.syncSucceeded" : "common.syncPending"));
			break;
		}
		case "sync-riot-user":
			await interaction.editReply(ctx.i18n.t((await ctx.riotSync.syncOne(interaction.guildId, member.id)) ? "common.syncSucceeded" : "common.riotTemporarilyUnavailable"));
			break;
		case "delete-registration-data": {
			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`delete:${interaction.guildId}:${member.id}:${actor.id}`).setLabel(ctx.i18n.t("button.confirmDelete")).setStyle(ButtonStyle.Danger),
				new ButtonBuilder().setCustomId(`cancel-delete:${actor.id}`).setLabel(ctx.i18n.t("button.cancel")).setStyle(ButtonStyle.Secondary)
			);
			await interaction.editReply({
				content: ctx.i18n.t("confirmation.deleteRegistrationData"),
				components: [row],
			});
			break;
		}
	}
}

async function registrationReply(interaction: ChatInputCommandInteraction, result: RegistrationResult, userId: string, ctx: InteractionContext): Promise<void> {
	const errors: Record<Exclude<RegistrationResult["kind"], "success">, Parameters<Localizer["t"]>[0]> = {
		"invalid-opgg": "registration.invalidOpggUrl",
		"name-required": "registration.nameRequired",
		"name-not-allowed": "registration.nameNotAllowedWhenHidden",
		"riot-not-found": "registration.riotAccountNotFound",
		"riot-unavailable": "registration.riotUnavailable",
		"duplicate-puuid": "registration.duplicatePuuid",
	};
	if (result.kind !== "success") {
		await interaction.editReply(ctx.i18n.t(errors[result.kind]));
		return;
	}
	const sync = await ctx.reconciliation.reconcile(interaction.guildId!, userId);
	if (sync.kind !== "success" && sync.kind !== "no-op") await interaction.editReply(ctx.i18n.t("registration.discordSyncPending"));
	else await interaction.editReply(ctx.i18n.t(result.visibility === "HIDDEN" ? "registration.hiddenSuccess" : "registration.success"));
}

async function handleSetup(interaction: ChatInputCommandInteraction, actor: GuildMember, ctx: InteractionContext): Promise<void> {
	const mode = interaction.options.getString("mode", true);
	if (["apply", "pause", "resume", "cancel"].includes(mode) && !ctx.permissions.isAdministrator(actor)) {
		await interaction.editReply(ctx.i18n.t("permissions.denied"));
		return;
	}
	if (mode === "preview") {
		if (ctx.migrations.active(interaction.guildId!)) {
			await interaction.editReply(ctx.i18n.t("migration.activeExists"));
			return;
		}
		const summary = await ctx.migrationService.preview(interaction.guild!, actor.id);
		const row = migrationButtons(summary.jobId, actor.id, summary.token, ctx.i18n);
		const counts = Object.entries(summary.counts)
			.map(([key, count]) => `${localizedMigrationCategory(key, ctx.i18n)}: ${count}`)
			.join("\n");
		await interaction.editReply({
			content: `**${ctx.i18n.t("migration.previewTitle")}**\n${ctx.i18n.t("migration.previewBody", { total: summary.total })}\n\n${counts}`.slice(0, 1900),
			components: [row],
		});
		return;
	}
	const activeJob = ctx.migrations.active(interaction.guildId!);
	if (mode === "cancel") {
		if (!activeJob) {
			await interaction.editReply(ctx.i18n.t("migration.noActive"));
			return;
		}
		ctx.migrations.cancel(activeJob.id);
		await interaction.editReply(ctx.i18n.t("migration.activeCancelled"));
		return;
	}
	if (mode === "apply" && activeJob) {
		await interaction.editReply(ctx.i18n.t("migration.activeExists"));
		return;
	}
	const job = mode === "apply" ? ctx.migrations.latest(interaction.guildId!) : (activeJob ?? ctx.migrations.latest(interaction.guildId!));
	if (!job) {
		await interaction.editReply(ctx.i18n.t("migration.noPreview"));
		return;
	}
	if (mode === "unknown") {
		await interaction.editReply(unknownFormatPage(job.id, actor.id, 0, ctx));
		return;
	}
	if (mode === "manual-review") {
		await interaction.editReply(manualReviewPage(job.id, actor.id, 0, ctx));
		return;
	}
	if (mode === "apply") {
		if (job.status !== "PREVIEWED") {
			await interaction.editReply(ctx.i18n.t("migration.noPreview"));
			return;
		}
		const token = ctx.migrationService.createConfirmation(job.id);
		await interaction.editReply({
			content: ctx.i18n.t("migration.previewBody", { total: job.totalMembers }),
			components: [migrationButtons(job.id, actor.id, token, ctx.i18n)],
		});
		return;
	}
	if (mode === "pause") {
		if (job.status !== "RUNNING") {
			await interaction.editReply(ctx.i18n.t("migration.notRunning"));
			return;
		}
		ctx.migrations.pause(job.id, "MANUAL");
		await interaction.editReply(ctx.i18n.t("migration.paused"));
		return;
	}
	if (mode === "resume") {
		if (job.status !== "PAUSED") {
			await interaction.editReply(ctx.i18n.t("migration.notPaused"));
			return;
		}
		ctx.migrations.resume(job.id);
		await interaction.editReply(ctx.i18n.t("migration.confirmed"));
		return;
	}
	await interaction.editReply(migrationStatusPage(job.id, actor.id, ctx));
	startLiveMigrationStatus(interaction, job.id, actor.id, ctx);
}

async function handleButton(interaction: ButtonInteraction, ctx: InteractionContext): Promise<void> {
	const parts = interaction.customId.split(":");
	if (parts[0] === "migration-status" && parts.length === 3) {
		const [, jobId, actorId] = parts;
		if (interaction.user.id !== actorId) {
			await interaction.reply({ content: ctx.i18n.t("permissions.denied"), flags: MessageFlags.Ephemeral });
			return;
		}
		const job = ctx.migrations.getJob(jobId!);
		if (!job) {
			await interaction.update({ content: ctx.i18n.t("migration.noPreview"), embeds: [], components: [] });
			return;
		}
		await interaction.update(migrationStatusPage(job.id, actorId!, ctx));
		startLiveMigrationStatus(interaction, job.id, actorId!, ctx);
		return;
	}
	if (parts[0] === "migration-manual" && parts.length === 4) {
		const [, jobId, actorId, rawPage] = parts;
		if (interaction.user.id !== actorId) {
			await interaction.reply({ content: ctx.i18n.t("permissions.denied"), flags: MessageFlags.Ephemeral });
			return;
		}
		stopLiveMigrationStatus(jobId!, actorId!);
		await interaction.update(manualReviewPage(jobId!, actorId!, Number(rawPage), ctx));
		return;
	}
	if (parts[0] === "migration-unknown" && parts.length === 4) {
		const [, jobId, actorId, rawPage] = parts;
		if (interaction.user.id !== actorId) {
			await interaction.reply({
				content: ctx.i18n.t("permissions.denied"),
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await interaction.update(unknownFormatPage(jobId!, actorId!, Number(rawPage), ctx));
		return;
	}
	if (parts[0] === "migration" && parts.length === 4) {
		const [, jobId, actorId, token] = parts;
		if (interaction.user.id !== actorId) {
			await interaction.reply({
				content: ctx.i18n.t("permissions.denied"),
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const guild = await ctx.client.guilds.fetch(interaction.guildId!);
		const actor = await guild.members.fetch(actorId!);
		if (!ctx.permissions.isAdministrator(actor)) {
			await interaction.reply({
				content: ctx.i18n.t("permissions.denied"),
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const diagnostics = await diagnoseGuild(ctx.client, guild, ctx.config, ctx.i18n);
		if (diagnostics.errors.length) {
			await interaction.update({
				content: diagnostics.errors.join("\n").slice(0, 1900),
				components: [],
			});
			return;
		}
		const ok = ctx.migrationService.confirm(jobId!, actorId!, token!);
		if (!ok) {
			await interaction.update({ content: ctx.i18n.t("migration.noPreview"), embeds: [], components: [] });
			return;
		}
		await interaction.update(migrationStatusPage(jobId!, actorId!, ctx));
		startLiveMigrationStatus(interaction, jobId!, actorId!, ctx);
		return;
	}
	if (parts[0] === "cancel-migration" && parts.length === 3) {
		const [, jobId, actorId] = parts;
		if (interaction.user.id !== actorId) {
			await interaction.reply({
				content: ctx.i18n.t("permissions.denied"),
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		ctx.migrations.cancel(jobId!);
		await interaction.update({
			content: ctx.i18n.t("migration.cancelled"),
			components: [],
		});
		return;
	}
	if (parts[0] === "delete" && parts.length === 4) {
		const [, guildId, userId, actorId] = parts;
		if (interaction.user.id !== actorId) {
			await interaction.reply({
				content: ctx.i18n.t("permissions.denied"),
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const guild = await ctx.client.guilds.fetch(guildId!);
		const actor = await guild.members.fetch(actorId!);
		if (!ctx.permissions.isStaff(actor)) {
			await interaction.reply({
				content: ctx.i18n.t("permissions.denied"),
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		ctx.registrations.deletePersonalData(guildId!, userId!, actorId!);
		await ctx.reconciliation.reconcile(guildId!, userId!);
		await interaction.update({
			content: ctx.i18n.t("registration.deleted"),
			components: [],
		});
		return;
	}
	if (parts[0]?.startsWith("cancel-"))
		await interaction.update({
			content: ctx.i18n.t("migration.cancelled"),
			components: [],
		});
}

function migrationButtons(jobId: string, actorId: string, token: string, i18n: Localizer) {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(`migration:${jobId}:${actorId}:${token}`).setLabel(i18n.t("migration.confirmButton")).setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId(`cancel-migration:${jobId}:${actorId}`).setLabel(i18n.t("migration.cancelButton")).setStyle(ButtonStyle.Secondary)
	);
}

function unknownFormatPage(jobId: string, actorId: string, requestedPage: number, ctx: InteractionContext) {
	const items = ctx.migrations.items(jobId).filter((item) => item.category === "UNKNOWN_FORMAT");
	if (!items.length)
		return {
			content: ctx.i18n.t("migration.unknownEmpty"),
			components: [],
		};
	const pageSize = 15;
	const pageCount = Math.ceil(items.length / pageSize);
	const page = Math.max(0, Math.min(Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 0, pageCount - 1));
	const lines = items.slice(page * pageSize, (page + 1) * pageSize).map((item) =>
		ctx.i18n.t("migration.unknownEntry", {
			username: escapeDiscordMarkdown(item.usernameSnapshot),
			userId: item.userId,
			nickname: item.originalNickname ? escapeDiscordMarkdown(item.originalNickname) : ctx.i18n.t("migration.noNickname"),
		})
	);
	const components =
		pageCount > 1
			? [
					new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(`migration-unknown:${jobId}:${actorId}:${page - 1}`)
							.setLabel(ctx.i18n.t("button.previous"))
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(page === 0),
						new ButtonBuilder()
							.setCustomId(`migration-unknown:${jobId}:${actorId}:${page + 1}`)
							.setLabel(ctx.i18n.t("button.next"))
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(page === pageCount - 1)
					),
				]
			: [];
	return {
		content: `**${ctx.i18n.t("migration.unknownTitle")}**\n${ctx.i18n.t("migration.unknownPage", {
			page: page + 1,
			pages: pageCount,
			total: items.length,
		})}\n\n${lines.join("\n")}`.slice(0, 1900),
		components,
	};
}

function migrationStatusPage(jobId: string, actorId: string, ctx: InteractionContext) {
	const job = ctx.migrations.getJob(jobId);
	if (!job) return { content: ctx.i18n.t("migration.noPreview"), embeds: [], components: [] };
	return migrationStatusMessage(job, ctx.migrations.manualReviewItems(jobId), actorId, ctx.i18n, ctx.migrations.pendingRetryCount(jobId));
}

function manualReviewPage(jobId: string, actorId: string, requestedPage: number, ctx: InteractionContext) {
	const job = ctx.migrations.getJob(jobId);
	if (!job) return { content: ctx.i18n.t("migration.noPreview"), embeds: [], components: [] };
	const items = ctx.migrations.manualReviewItems(jobId);
	const conflicts = new Map<string, string>();
	for (const item of items) {
		try {
			const metadata = JSON.parse(item.metadata) as { conflictingUserId?: unknown };
			const fallback =
				item.lastErrorCode === "DUPLICATE_PUUID_MANUAL_REVIEW" && item.parsedGameName && item.parsedTagLine
					? ctx.registrations.findRegisteredByRiotId(job.guildId, `${item.parsedGameName}#${item.parsedTagLine}`, item.userId)
					: undefined;
			const conflictingUserId = typeof metadata.conflictingUserId === "string" ? metadata.conflictingUserId : fallback?.userId;
			if (!conflictingUserId) continue;
			const row = fallback?.userId === conflictingUserId ? fallback : ctx.registrations.get(job.guildId, conflictingUserId);
			conflicts.set(conflictingUserId, row?.discordUsernameSnapshot ? `${escapeDiscordMarkdown(row.discordUsernameSnapshot)} (${conflictingUserId})` : conflictingUserId);
			if (typeof metadata.conflictingUserId !== "string") item.metadata = JSON.stringify({ conflictingUserId });
		} catch {
			// Invalid historical metadata is shown without a conflict label.
		}
	}
	return manualReviewMessage(job, items, actorId, requestedPage, ctx.i18n, conflicts);
}

type StatusInteraction = ChatInputCommandInteraction | ButtonInteraction;
const liveMigrationStatusTimers = new Map<string, NodeJS.Timeout>();

function startLiveMigrationStatus(interaction: StatusInteraction, jobId: string, actorId: string, ctx: InteractionContext): void {
	stopLiveMigrationStatus(jobId, actorId);
	const initial = ctx.migrations.getJob(jobId);
	if (initial?.status !== "RUNNING") return;
	const key = `${jobId}:${actorId}`;
	const expiresAt = Date.now() + 14 * 60_000;
	const schedule = () => {
		const timer = setTimeout(async () => {
			if (liveMigrationStatusTimers.get(key) !== timer) return;
			const job = ctx.migrations.getJob(jobId);
			if (!job) {
				liveMigrationStatusTimers.delete(key);
				return;
			}
			try {
				await interaction.editReply(migrationStatusPage(jobId, actorId, ctx));
			} catch {
				liveMigrationStatusTimers.delete(key);
				return;
			}
			if (job.status !== "RUNNING" || Date.now() + 30_000 >= expiresAt) {
				liveMigrationStatusTimers.delete(key);
				return;
			}
			schedule();
		}, 30_000);
		timer.unref();
		liveMigrationStatusTimers.set(key, timer);
	};
	schedule();
}

function stopLiveMigrationStatus(jobId: string, actorId: string): void {
	const key = `${jobId}:${actorId}`;
	const timer = liveMigrationStatusTimers.get(key);
	if (timer) clearTimeout(timer);
	liveMigrationStatusTimers.delete(key);
}

function escapeDiscordMarkdown(value: string): string {
	return value.replace(/[\r\n]+/g, " ").replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, "\\$1");
}

function localizedRegistrationStatus(status: string, i18n: Localizer): string {
	return i18n.t(
		status === "REGISTERED"
			? "status.registered"
			: status === "VERIFIED_NO_RIOT"
				? "status.verifiedNoRiot"
				: status === "UNREGISTERED"
					? "status.unregistered"
					: "status.pending"
	);
}
function localizedVisibility(visibility: string | null, i18n: Localizer): string {
	return visibility === "VISIBLE" ? i18n.t("visibility.visible") : visibility === "HIDDEN" ? i18n.t("visibility.hidden") : "–";
}
function localizedMigrationCategory(category: string, i18n: Localizer): string {
	const keys: Record<string, Parameters<Localizer["t"]>[0]> = {
		LEGACY_REGISTERED_VISIBLE_NAME: "migration.category.visible",
		LEGACY_REGISTERED_HIDDEN_NAME: "migration.category.hidden",
		LEGACY_VERIFIED_NO_RIOT: "migration.category.verifiedNoRiot",
		LEGACY_UNREGISTERED: "migration.category.unregistered",
		UNKNOWN_FORMAT: "migration.category.unknown",
		UNMANAGEABLE: "migration.category.unmanageable",
		EXEMPT: "migration.category.exempt",
		PENDING_RIOT_VERIFICATION: "migration.category.pending",
	};
	return keys[category] ? i18n.t(keys[category]) : i18n.t("migration.category.unknown");
}
function localizedSync(status: string, i18n: Localizer): string {
	const keys: Record<string, Parameters<Localizer["t"]>[0]> = {
		NOT_REQUIRED: "sync.notRequired",
		PENDING: "sync.pending",
		IN_PROGRESS: "sync.inProgress",
		SUCCEEDED: "sync.succeeded",
		FAILED_RETRYABLE: "sync.retryable",
		FAILED_PERMANENT: "sync.permanent",
	};
	return i18n.t(keys[status] ?? "sync.pending");
}
