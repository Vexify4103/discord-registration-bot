import { z } from "zod";

const bool = (fallback: boolean) =>
	z
		.string()
		.optional()
		.transform((v) => (v == null ? fallback : v.toLowerCase() === "true"));
const integer = (fallback: number, min = 0) => z.coerce.number().int().min(min).default(fallback);
const csv = z
	.string()
	.optional()
	.transform(
		(v) =>
			v
				?.split(",")
				.map((x) => x.trim())
				.filter(Boolean) ?? []
	);
const snowflake = z.string().regex(/^\d{15,22}$/);

export const configSchema = z
	.object({
		DISCORD_TOKEN: z.string().min(20),
		DISCORD_APPLICATION_ID: snowflake,
		DISCORD_GUILD_ID: snowflake,
		DATABASE_PATH: z.string().min(1).default("./data/bot.sqlite"),
		VERIFIED_NAMED_ROLE_ID: snowflake,
		VERIFIED_PRIVATE_ROLE_ID: snowflake,
		UNREGISTERED_ROLE_ID: snowflake,
		STAFF_ROLE_IDS: csv,
		EXEMPT_ROLE_IDS: csv,
		EXEMPT_USER_IDS: csv,
		UNREGISTERED_NICKNAME_TEMPLATE: z.string().min(1).default("Unregistriert | {username}"),
		REGISTRATION_EXPIRY_DAYS: integer(7, 1),
		REGISTRATION_CLEANUP_INTERVAL_MINUTES: integer(60, 1),
		CLEANUP_ENABLED: bool(false),
		REGISTRATION_DATA_RETENTION_DAYS: integer(30, 0),
		MIGRATION_GRACE_PERIOD_DAYS: integer(7, 1),
		UNKNOWN_MEMBER_MIGRATION_POLICY: z.enum(["unregister", "skip", "require-manual-review"]).default("unregister"),
		LEGACY_ALLOW_WHITESPACE_VARIATIONS: bool(false),
		DEFAULT_RIOT_PLATFORM_REGION: z.enum(["EUW1", "EUN1", "TR1", "RU", "NA1", "BR1", "LA1", "LA2", "OC1", "KR", "JP1", "SG2", "PH2", "TW2", "TH2", "VN2"]).default("EUW1"),
		DEFAULT_RIOT_ACCOUNT_ROUTE: z.enum(["americas", "asia", "europe", "sea"]).default("europe"),
		LEGACY_RIOT_ACCOUNT_ROUTES: csv,
		RIOT_API_KEY: z.string().optional(),
		RIOT_SYNC_ENABLED: bool(true),
		RIOT_SYNC_INTERVAL_DAYS: integer(7, 1),
		RIOT_SYNC_WORKER_INTERVAL_MINUTES: integer(30, 1),
		RIOT_SYNC_BATCH_SIZE: integer(10, 1),
		RIOT_SYNC_MIN_DELAY_MS: integer(1000, 0),
		RIOT_SYNC_MAX_RETRIES: integer(3, 0),
		DISCORD_MEMBER_MUTATION_CONCURRENCY: integer(1, 1),
		DISCORD_MEMBER_MUTATION_MIN_DELAY_MS: integer(250, 0),
		DISCORD_OPERATION_MAX_RETRIES: integer(3, 0),
		SEND_DM_BEFORE_KICK: bool(true),
		NICKNAME_SYNC_MODE: z.enum(["lifecycle", "strict", "manual"]).default("lifecycle"),
		VERIFIED_ROLES_MENTIONABLE: bool(false),
		BOT_LOCALE: z.literal("de-DE").default("de-DE"),
		BOT_TIME_ZONE: z.string().default("Europe/Berlin"),
		BOT_ACTIVITY_TEXT: z.string().trim().min(1).max(128).default("Rollen-Tetris"),
		LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
	})
	.superRefine((value, ctx) => {
		const roles = [value.VERIFIED_NAMED_ROLE_ID, value.VERIFIED_PRIVATE_ROLE_ID, value.UNREGISTERED_ROLE_ID];
		if (new Set(roles).size !== roles.length)
			ctx.addIssue({
				code: "custom",
				message: "Die drei Registrierungsrollen müssen unterschiedliche IDs haben.",
			});
		if (!value.UNREGISTERED_NICKNAME_TEMPLATE.includes("{username}"))
			ctx.addIssue({
				code: "custom",
				path: ["UNREGISTERED_NICKNAME_TEMPLATE"],
				message: "Die Vorlage muss {username} enthalten.",
			});
		for (const [key, ids] of [
			["STAFF_ROLE_IDS", value.STAFF_ROLE_IDS],
			["EXEMPT_ROLE_IDS", value.EXEMPT_ROLE_IDS],
			["EXEMPT_USER_IDS", value.EXEMPT_USER_IDS],
		] as const) {
			if (ids.some((id) => !/^\d{15,22}$/.test(id)))
				ctx.addIssue({
					code: "custom",
					path: [key],
					message: `${key} enthält eine ungültige ID.`,
				});
		}
	});

export type AppConfig = z.infer<typeof configSchema>;
