import type { Message } from "discord.js";
import type { Logger } from "pino";
import type { InteractionContext } from "./interaction-handler.js";
import { executeLeagueCommand, type LeagueCommandRequest, type LeagueSubcommand } from "./league-command-handler.js";

export interface ParsedLeagueMention {
	subcommand: LeagueSubcommand;
	champion?: string;
	topType?: "total" | "champion";
}

export function parseLeagueMention(content: string, botUserId: string): ParsedLeagueMention | undefined {
	const match = content.trim().match(new RegExp(`^<@!?${botUserId}>(?:\\s+([\\s\\S]*))?$`));
	if (!match) return undefined;
	const input = (match[1] ?? "")
		.trim()
		.replace(/<@!?\d{15,22}>/g, "")
		.trim();
	if (!input) return { subcommand: "help" };
	const [rawCommand = "", ...rest] = input.split(/\s+/);
	const command = rawCommand.toLowerCase();
	const aliases: Record<string, LeagueSubcommand> = {
		profile: "profile",
		profil: "profile",
		mastery: "mastery",
		points: "mastery",
		punkte: "mastery",
		chart: "chart",
		stats: "chart",
		verlauf: "chart",
		top: "top",
		refresh: "refresh",
		aktualisieren: "refresh",
		roles: "roles",
		rollen: "roles",
		help: "help",
		hilfe: "help",
		about: "about",
		info: "about",
	};
	const subcommand = aliases[command];
	if (!subcommand) return undefined;
	if (subcommand === "chart") return { subcommand, ...(rest.length ? { champion: rest.join(" ") } : {}) };
	if (subcommand === "top") {
		if (!rest.length || rest[0]?.toLowerCase() === "total" || rest[0]?.toLowerCase() === "gesamt") return { subcommand, topType: "total" };
		return { subcommand, topType: "champion", champion: rest.join(" ") };
	}
	return { subcommand };
}

export function createLeagueMentionHandler(ctx: InteractionContext, logger: Logger) {
	return async (message: Message): Promise<void> => {
		if (!ctx.config.BOT_MENTION_COMMANDS_ENABLED || !message.inGuild() || message.guildId !== ctx.config.DISCORD_GUILD_ID || message.author.bot || !ctx.client.user) return;
		const parsed = parseLeagueMention(message.content, ctx.client.user.id);
		if (!parsed) return;
		try {
			const target = message.mentions.users.find((user) => user.id !== ctx.client.user!.id && !user.bot) ?? message.author;
			await message.channel.sendTyping();
			const request: LeagueCommandRequest = { guildId: message.guildId, userId: target.id, ...parsed };
			await message.reply(await executeLeagueCommand(request, ctx));
		} catch (error) {
			logger.error({ err: error, messageId: message.id, guildId: message.guildId }, "League mention command failed");
			await message.reply(ctx.i18n.t("common.unexpectedError")).catch(() => undefined);
		}
	};
}
