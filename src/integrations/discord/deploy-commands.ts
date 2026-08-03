import { REST, Routes } from "discord.js";
import { loadConfig } from "../../config/load.js";
import { Localizer } from "../../localization/formatter.js";
import { commandDefinitions } from "../../commands/definitions.js";

const config = loadConfig();
const i18n = new Localizer(config.BOT_LOCALE, config.BOT_TIME_ZONE);
const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(config.DISCORD_APPLICATION_ID, config.DISCORD_GUILD_ID), { body: commandDefinitions(i18n).map((command) => command.toJSON()) });
console.log("Discord-Befehle wurden für den konfigurierten Server bereitgestellt.");
