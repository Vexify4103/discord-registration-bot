import { AttachmentBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { InteractionContext } from "./interaction-handler.js";
import { renderMasteryChart } from "../services/mastery-chart.js";
import type { RankedTier } from "../types/domain.js";
import type { Localizer } from "../localization/formatter.js";
import type { MessageKey } from "../localization/keys.js";

export type LeagueSubcommand = "profile" | "mastery" | "chart" | "top" | "refresh" | "roles" | "help" | "about";
export interface LeagueCommandRequest {
	guildId: string;
	userId: string;
	subcommand: LeagueSubcommand;
	champion?: string;
	topType?: "total" | "champion";
}
export type LeagueResponse = string | { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] };

export async function handleLeagueCommand(interaction: ChatInputCommandInteraction, ctx: InteractionContext): Promise<void> {
	const subcommand = interaction.options.getSubcommand(true) as LeagueSubcommand;
	const target = interaction.options.getUser("member") ?? interaction.user;
	const response = await executeLeagueCommand(
		{
			guildId: interaction.guildId!,
			userId: target.id,
			subcommand,
			...(subcommand === "chart" ? { champion: interaction.options.getString("champion", true) } : {}),
			...(subcommand === "top"
				? {
						topType: interaction.options.getString("type", true) as "total" | "champion",
						...(interaction.options.getString("champion") ? { champion: interaction.options.getString("champion")! } : {}),
					}
				: {}),
		},
		ctx
	);
	await interaction.editReply(response);
}

export async function executeLeagueCommand(request: LeagueCommandRequest, ctx: InteractionContext): Promise<LeagueResponse> {
	if (request.subcommand === "help" || request.subcommand === "about")
		return {
			embeds: [
				new EmbedBuilder()
					.setColor(0x5865f2)
					.setTitle(ctx.i18n.t(request.subcommand === "help" ? "league.helpTitle" : "league.aboutTitle"))
					.setDescription(ctx.i18n.t(request.subcommand === "help" ? "league.helpBody" : "league.aboutBody")),
			],
		};
	const registration = await ctx.registrations.get(request.guildId, request.userId);
	if (!registration?.puuid || registration.status !== "REGISTERED") return ctx.i18n.t("league.notRegistered");
	if (request.subcommand === "refresh") {
		const recent = await ctx.league.profile(request.guildId, request.userId);
		if (recent?.lastStatsSyncAt && recent.lastStatsSyncAt > Date.now() - 5 * 60_000) {
			await ctx.reconciliation.reconcile(request.guildId, request.userId);
			return ctx.i18n.t("league.refreshSuccess");
		}
		const ok = await ctx.leagueStats.syncOne(request.guildId, request.userId);
		if (ok) await ctx.reconciliation.reconcile(request.guildId, request.userId);
		return ctx.i18n.t(ok ? "league.refreshSuccess" : "league.refreshFailed");
	}
	const profile = await ctx.league.profile(request.guildId, request.userId);
	if (!profile?.lastStatsSyncAt) return ctx.i18n.t("league.noData");
	if (request.subcommand === "profile")
		return {
			embeds: [
				new EmbedBuilder()
					.setColor(0x5865f2)
					.setTitle(ctx.i18n.t("league.profileTitle", { riotId: registration.riotId }))
					.setDescription(
						ctx.i18n.t("league.profileBody", {
							level: profile.summonerLevel ?? 0,
							solo: localizedRank(profile.soloTier, profile.soloDivision, profile.soloLeaguePoints, ctx.i18n),
							flex: localizedRank(profile.flexTier, profile.flexDivision, profile.flexLeaguePoints, ctx.i18n),
							effective: localizedRank(profile.effectiveTier, profile.effectiveDivision, profile.effectiveLeaguePoints, ctx.i18n),
							mastery: formatNumber(profile.totalMasteryScore),
							updated: ctx.i18n.date(profile.lastStatsSyncAt),
						})
					),
			],
		};
	if (request.subcommand === "mastery") {
		const masteries = await ctx.league.masteries(request.guildId, request.userId, 10);
		if (!masteries.length) return ctx.i18n.t("league.noData");
		const names = await Promise.all(masteries.map((row) => ctx.champions.name(row.championId)));
		return {
			embeds: [
				new EmbedBuilder()
					.setColor(0xeb459e)
					.setTitle(ctx.i18n.t("league.masteryTitle", { riotId: registration.riotId }))
					.setDescription(
						masteries
							.map((row, index) =>
								ctx.i18n.t("league.masteryEntry", {
									position: index + 1,
									champion: names[index],
									level: row.championLevel,
									points: formatNumber(row.championPoints),
								})
							)
							.join("\n")
					),
			],
		};
	}
	if (request.subcommand === "chart") {
		if (!request.champion) return ctx.i18n.t("league.championNotFound");
		const championId = await ctx.champions.resolve(request.champion);
		if (!championId) return ctx.i18n.t("league.championNotFound");
		const history = await ctx.league.history(request.guildId, request.userId, championId);
		if (history.length < 2) return ctx.i18n.t("league.historyInsufficient");
		const champion = await ctx.champions.name(championId);
		const png = renderMasteryChart(history.map((point) => ({ time: point.capturedAt, points: point.championPoints })));
		const first = history[0]!;
		const last = history.at(-1)!;
		return {
			embeds: [
				new EmbedBuilder()
					.setColor(0xeb459e)
					.setTitle(ctx.i18n.t("league.chartTitle", { champion }))
					.setDescription(
						`${formatNumber(first.championPoints)} → **${formatNumber(last.championPoints)}** (+${formatNumber(last.championPoints - first.championPoints)})`
					)
					.setImage("attachment://mastery-verlauf.png"),
			],
			files: [new AttachmentBuilder(png, { name: "mastery-verlauf.png" })],
		};
	}
	if (request.subcommand === "top") {
		let rows: Array<{ userId: string; points: number }>;
		let category = ctx.i18n.t("command.league.topTotal");
		if (request.topType === "champion") {
			if (!request.champion) return ctx.i18n.t("league.championNotFound");
			const championId = await ctx.champions.resolve(request.champion);
			if (!championId) return ctx.i18n.t("league.championNotFound");
			rows = await ctx.league.championLeaderboard(request.guildId, championId);
			category = await ctx.champions.name(championId);
		} else rows = await ctx.league.totalLeaderboard(request.guildId);
		if (!rows.length) return ctx.i18n.t("league.noData");
		return {
			embeds: [
				new EmbedBuilder()
					.setColor(0xfee75c)
					.setTitle(ctx.i18n.t("league.topTitle", { category }))
					.setDescription(
						rows.map((row, index) => ctx.i18n.t("league.topEntry", { position: index + 1, userId: row.userId, points: formatNumber(row.points) })).join("\n")
					),
			],
		};
	}
	const roleId = roleIdForTier(ctx, profile.effectiveTier);
	const expectedRole = !ctx.config.RANK_ROLE_SYNC_ENABLED ? ctx.i18n.t("league.rankRoleDisabled") : roleId ? `<@&${roleId}>` : ctx.i18n.t("league.rankUnranked");
	return {
		embeds: [
			new EmbedBuilder()
				.setColor(0x57f287)
				.setTitle(ctx.i18n.t("league.rolesTitle", { riotId: registration.riotId }))
				.setDescription(
					ctx.i18n.t("league.rolesBody", {
						rank: localizedRank(profile.effectiveTier, profile.effectiveDivision, profile.effectiveLeaguePoints, ctx.i18n),
						role: expectedRole,
					})
				),
		],
	};
}

function roleIdForTier(ctx: InteractionContext, tier: RankedTier | null): string | undefined {
	return ctx.config[`RANK_ROLE_${tier ?? "UNRANKED"}_ID` as keyof typeof ctx.config] as string | undefined;
}
const formatNumber = (value: number) => new Intl.NumberFormat("de-DE").format(value);

function localizedRank(tier: RankedTier | null, division: string | null, leaguePoints: number | null, i18n: Localizer): string {
	if (!tier) return i18n.t("league.rankUnranked");
	const divisionText = tier === "MASTER" || tier === "GRANDMASTER" || tier === "CHALLENGER" ? "" : ` ${division ?? ""}`;
	return i18n.t("league.rankLabel", { tier: i18n.t(`rank.${tier}` as MessageKey), division: divisionText, lp: leaguePoints ?? 0 });
}
