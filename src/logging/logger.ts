import pino, { type Logger } from "pino";
import type { AppConfig } from "../config/schema.js";

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL">): Logger {
	return pino({
		level: config.LOG_LEVEL,
		redact: {
			paths: [
				"BOT_LOG_WEBHOOK_URL",
				"*.BOT_LOG_WEBHOOK_URL",
				"webhookUrl",
				"*.webhookUrl",
				"token",
				"apiKey",
				"RIOT_API_KEY",
				"DISCORD_TOKEN",
				"MONGODB_URI",
				"*.MONGODB_URI",
				"mongoUri",
				"*.mongoUri",
				"*.token",
				"*.apiKey",
				"*.puuid",
				"*.opggUrl",
				"*.displayName",
				"*.url",
				"*.route",
				"*.requestBody",
				"err.url",
				"err.route",
				"err.requestBody",
			],
			censor: "[REDACTED]",
		},
		base: { service: "discord-registration-bot" },
	});
}
