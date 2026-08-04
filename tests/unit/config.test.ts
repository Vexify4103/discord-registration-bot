import { describe, expect, it } from "vitest";
import { configSchema } from "../../src/config/schema.js";

const requiredEnvironment = {
	DISCORD_TOKEN: "x".repeat(20),
	DISCORD_APPLICATION_ID: "100000000000000001",
	DISCORD_GUILD_ID: "100000000000000002",
	MONGODB_URI: "mongodb://localhost:27017/gaming_community?replicaSet=gaming-rs",
	VERIFIED_NAMED_ROLE_ID: "100000000000000003",
	VERIFIED_PRIVATE_ROLE_ID: "100000000000000004",
	UNREGISTERED_ROLE_ID: "100000000000000005",
};

describe("cleanup configuration", () => {
	it("keeps automatic kicks disabled by default", () => expect(configSchema.parse(requiredEnvironment).CLEANUP_ENABLED).toBe(false));
	it("requires an explicit true value to enable automatic kicks", () =>
		expect(
			configSchema.parse({
				...requiredEnvironment,
				CLEANUP_ENABLED: "true",
			}).CLEANUP_ENABLED
		).toBe(true));
});

describe("migration policy configuration", () => {
	it("treats unknown nickname formats as unregistered by default", () => expect(configSchema.parse(requiredEnvironment).UNKNOWN_MEMBER_MIGRATION_POLICY).toBe("unregister"));
});

describe("bot presence configuration", () => {
	it("uses a German activity by default", () => expect(configSchema.parse(requiredEnvironment).BOT_ACTIVITY_TEXT).toBe("Rollen-Tetris"));
	it("rejects an empty activity", () => expect(() => configSchema.parse({ ...requiredEnvironment, BOT_ACTIVITY_TEXT: " " })).toThrow());
	it("keeps mention commands opt-in", () => expect(configSchema.parse(requiredEnvironment).BOT_MENTION_COMMANDS_ENABLED).toBe(false));
});

describe("Discord audit webhook configuration", () => {
	it("keeps webhook logging optional", () => expect(configSchema.parse(requiredEnvironment).BOT_LOG_WEBHOOK_URL).toBeUndefined());
	it("accepts an incoming Discord webhook", () =>
		expect(
			configSchema.parse({
				...requiredEnvironment,
				BOT_LOG_WEBHOOK_URL: "https://discord.com/api/webhooks/100000000000000099/example_token-value",
			}).BOT_LOG_WEBHOOK_URL
		).toContain("discord.com/api/webhooks"));
	it("rejects non-Discord and malformed webhook URLs", () => {
		expect(() => configSchema.parse({ ...requiredEnvironment, BOT_LOG_WEBHOOK_URL: "https://example.com/api/webhooks/100000000000000099/token" })).toThrow();
		expect(() => configSchema.parse({ ...requiredEnvironment, BOT_LOG_WEBHOOK_URL: "https://discord.com/channels/100/200" })).toThrow();
	});
});

describe("rank role configuration", () => {
	it("allows the feature to remain disabled without role IDs", () => expect(configSchema.parse(requiredEnvironment).RANK_ROLE_SYNC_ENABLED).toBe(false));
	it("requires every distinct tier role when enabled", () =>
		expect(() => configSchema.parse({ ...requiredEnvironment, RANK_ROLE_SYNC_ENABLED: "true", RANK_ROLE_IRON_ID: "100000000000000010" })).toThrow());
	it("accepts an unranked role plus all ten ranked tier roles", () => {
		const roleKeys = ["UNRANKED", "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
		const roles = Object.fromEntries(roleKeys.map((key, index) => [`RANK_ROLE_${key}_ID`, `1000000000000000${String(index + 10).padStart(2, "0")}`]));
		expect(configSchema.parse({ ...requiredEnvironment, RANK_ROLE_SYNC_ENABLED: "true", ...roles }).RANK_ROLE_UNRANKED_ID).toBe("100000000000000010");
	});
});
