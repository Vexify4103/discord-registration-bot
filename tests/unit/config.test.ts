import { describe, expect, it } from "vitest";
import { configSchema } from "../../src/config/schema.js";

const requiredEnvironment = {
	DISCORD_TOKEN: "x".repeat(20),
	DISCORD_APPLICATION_ID: "100000000000000001",
	DISCORD_GUILD_ID: "100000000000000002",
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
