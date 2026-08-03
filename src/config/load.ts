import { configSchema, type AppConfig } from "./schema.js";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	const parsed = configSchema.safeParse(env);
	if (!parsed.success) {
		const details = parsed.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("\n");
		throw new Error(`Ungültige Konfiguration:\n${details}`);
	}
	return parsed.data;
}

export function riotConfigured(config: AppConfig): boolean {
	return Boolean(config.RIOT_API_KEY?.trim());
}
