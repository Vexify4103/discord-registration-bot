import pino, { type Logger } from "pino";
import type { AppConfig } from "../config/schema.js";

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL">): Logger {
	return pino({
		level: config.LOG_LEVEL,
		redact: {
			paths: ["token", "apiKey", "RIOT_API_KEY", "DISCORD_TOKEN", "*.token", "*.apiKey", "*.puuid", "*.opggUrl", "*.displayName"],
			censor: "[REDACTED]",
		},
		base: { service: "discord-registration-bot" },
	});
}
