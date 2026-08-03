import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type InteractionEditReplyOptions } from "discord.js";
import type { MigrationItem, MigrationJob } from "../database/schema/index.js";
import type { Localizer } from "../localization/formatter.js";

const MANUAL_PAGE_SIZE = 8;
const PROGRESS_SEGMENTS = 16;

export function migrationStatusMessage(
	job: MigrationJob,
	manualItems: MigrationItem[],
	actorId: string,
	i18n: Localizer,
	pendingRetryCount = Math.max(0, job.pendingMembers - manualItems.length)
): InteractionEditReplyOptions {
	const percent = job.totalMembers > 0 ? Math.min(100, (job.processedMembers / job.totalMembers) * 100) : 100;
	const remaining = Math.max(0, job.totalMembers - job.processedMembers);
	const embed = new EmbedBuilder()
		.setTitle(i18n.t("migration.statusTitle"))
		.setColor(statusColor(job.status))
		.setDescription(
			i18n.t("migration.progressLine", {
				bar: migrationProgressBar(job.processedMembers, job.totalMembers),
				percent: percent.toLocaleString(i18n.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
			})
		)
		.addFields(
			{ name: i18n.t("migration.statusFieldState"), value: localizedState(job.status, i18n), inline: true },
			{ name: i18n.t("migration.statusFieldProcessed"), value: `${job.processedMembers} / ${job.totalMembers}`, inline: true },
			{ name: i18n.t("migration.statusFieldRemaining"), value: String(remaining), inline: true },
			{ name: i18n.t("migration.statusFieldVerified"), value: String(job.verifiedMembers), inline: true },
			{ name: i18n.t("migration.statusFieldUnregistered"), value: String(job.unregisteredMembers), inline: true },
			{ name: i18n.t("migration.statusFieldManual"), value: String(manualItems.length), inline: true },
			{ name: i18n.t("migration.statusFieldPendingRetry"), value: String(pendingRetryCount), inline: true },
			{ name: i18n.t("migration.statusFieldFailed"), value: String(job.failedMembers), inline: true }
		)
		.setFooter({ text: i18n.t(job.status === "RUNNING" ? "migration.statusLiveFooter" : "migration.statusStaticFooter") })
		.setTimestamp(new Date(job.updatedAt));

	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(`migration-status:${job.id}:${actorId}`).setLabel(i18n.t("migration.refreshButton")).setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId(`migration-manual:${job.id}:${actorId}:0`)
			.setLabel(i18n.t("migration.manualReviewButton", { count: manualItems.length }))
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(manualItems.length === 0)
	);
	return { content: null, embeds: [embed], components: [row] };
}

export function manualReviewMessage(
	job: MigrationJob,
	items: MigrationItem[],
	actorId: string,
	requestedPage: number,
	i18n: Localizer,
	conflictingUsers: ReadonlyMap<string, string> = new Map()
): InteractionEditReplyOptions {
	if (!items.length) {
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`migration-status:${job.id}:${actorId}`).setLabel(i18n.t("migration.backToStatusButton")).setStyle(ButtonStyle.Secondary)
		);
		return {
			content: null,
			embeds: [new EmbedBuilder().setTitle(i18n.t("migration.manualReviewTitle")).setDescription(i18n.t("migration.manualReviewEmpty")).setColor(0x57f287)],
			components: [row],
		};
	}
	const pageCount = Math.ceil(items.length / MANUAL_PAGE_SIZE);
	const page = Math.max(0, Math.min(Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 0, pageCount - 1));
	const embed = new EmbedBuilder()
		.setTitle(i18n.t("migration.manualReviewTitle"))
		.setDescription(i18n.t("migration.manualReviewPage", { page: page + 1, pages: pageCount, total: items.length }))
		.setColor(0xfee75c);
	for (const item of items.slice(page * MANUAL_PAGE_SIZE, (page + 1) * MANUAL_PAGE_SIZE)) {
		const conflictingUserId = readConflictingUserId(item.metadata);
		embed.addFields({
			name: `${escapeDiscordMarkdown(item.usernameSnapshot)} (${item.userId})`.slice(0, 256),
			value: i18n
				.t("migration.manualReviewEntry", {
					nickname: item.originalNickname ? escapeDiscordMarkdown(item.originalNickname) : i18n.t("migration.noNickname"),
					reason: localizedManualReason(item.lastErrorCode, i18n),
					conflict: conflictingUserId ? (conflictingUsers.get(conflictingUserId) ?? conflictingUserId) : i18n.t("migration.manualReviewNoConflict"),
				})
				.slice(0, 1024),
		});
	}
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`migration-manual:${job.id}:${actorId}:${page - 1}`)
			.setLabel(i18n.t("button.previous"))
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page === 0),
		new ButtonBuilder().setCustomId(`migration-status:${job.id}:${actorId}`).setLabel(i18n.t("migration.backToStatusButton")).setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId(`migration-manual:${job.id}:${actorId}:${page + 1}`)
			.setLabel(i18n.t("button.next"))
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page === pageCount - 1)
	);
	return { content: null, embeds: [embed], components: [row] };
}

export function migrationProgressBar(processed: number, total: number): string {
	const ratio = total > 0 ? Math.max(0, Math.min(1, processed / total)) : 1;
	const completed = Math.round(ratio * PROGRESS_SEGMENTS);
	return `${"█".repeat(completed)}${"░".repeat(PROGRESS_SEGMENTS - completed)}`;
}

function localizedState(status: string, i18n: Localizer): string {
	const keys = {
		PREVIEWED: "migration.state.previewed",
		RUNNING: "migration.state.running",
		PAUSED: "migration.state.paused",
		COMPLETED: "migration.state.completed",
		CANCELLED: "migration.state.cancelled",
	} as const;
	return i18n.t(keys[status as keyof typeof keys] ?? "migration.state.paused");
}

function localizedManualReason(code: string | null, i18n: Localizer): string {
	if (code === "DUPLICATE_PUUID_MANUAL_REVIEW") return i18n.t("migration.manualReasonDuplicate");
	if (code === "RIOT_NOT_FOUND_MANUAL_REVIEW") return i18n.t("migration.manualReasonRiotNotFound");
	if (code === "MANUAL_REVIEW") return i18n.t("migration.manualReasonUnknownFormat");
	return i18n.t("migration.manualReasonOther");
}

function readConflictingUserId(metadata: string): string | null {
	try {
		const parsed = JSON.parse(metadata) as { conflictingUserId?: unknown };
		return typeof parsed.conflictingUserId === "string" ? parsed.conflictingUserId : null;
	} catch {
		return null;
	}
}

function statusColor(status: string): number {
	if (status === "COMPLETED") return 0x57f287;
	if (status === "RUNNING") return 0x5865f2;
	if (status === "PAUSED") return 0xfee75c;
	if (status === "CANCELLED") return 0x99aab5;
	return 0x5865f2;
}

function escapeDiscordMarkdown(value: string): string {
	return value.replace(/[\r\n]+/g, " ").replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, "\\$1");
}
