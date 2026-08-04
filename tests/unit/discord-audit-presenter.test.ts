import { describe, expect, it } from "vitest";
import { configSchema } from "../../src/config/schema.js";
import type { AuditEvent } from "../../src/database/schema/index.js";
import { Localizer } from "../../src/localization/formatter.js";
import { DiscordAuditPresenter } from "../../src/services/discord-audit-presenter.js";

const config = configSchema.parse({
	DISCORD_TOKEN: "x".repeat(20),
	DISCORD_APPLICATION_ID: "100000000000000001",
	DISCORD_GUILD_ID: "100000000000000002",
	VERIFIED_NAMED_ROLE_ID: "100000000000000003",
	VERIFIED_PRIVATE_ROLE_ID: "100000000000000004",
	UNREGISTERED_ROLE_ID: "100000000000000005",
});

const event = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
	id: "event-1",
	guildId: config.DISCORD_GUILD_ID,
	targetUserId: "100000000000000006",
	actorUserId: null,
	action: "ADD_VERIFIED_NAMED_ROLE",
	result: "SUCCESS",
	metadata: JSON.stringify({ displayName: "Geheimer Name", puuid: "secret-puuid", roleId: "100000000000000099" }),
	correlationId: "correlation-1",
	schemaVersion: 1,
	createdAt: 1_785_840_000_000,
	...overrides,
});

describe("DiscordAuditPresenter", () => {
	const presenter = new DiscordAuditPresenter(config, new Localizer());

	it("renders a German role update without personal audit metadata", () => {
		const json = JSON.stringify(presenter.embed(event()).toJSON());
		expect(json).toContain("Mitgliederrollen aktualisiert");
		expect(json).toContain(`<@&${config.VERIFIED_NAMED_ROLE_ID}>`);
		expect(json).toContain("Automatisch");
		expect(json).not.toContain("Geheimer Name");
		expect(json).not.toContain("secret-puuid");
	});

	it("uses the safe rank-role metadata only for rank changes", () => {
		const json = JSON.stringify(presenter.embed(event({ action: "REMOVE_RANK_ROLE" })).toJSON());
		expect(json).toContain("<@&100000000000000099>");
		expect(json).toContain("League-Rang synchronisiert");
	});

	it("does not expose nickname contents", () => {
		const json = JSON.stringify(presenter.embed(event({ action: "SET_NICKNAME", metadata: JSON.stringify({ nickname: "Martin | Riot#EUW" }) })).toJSON());
		expect(json).toContain("Server-Nickname aktualisiert");
		expect(json).not.toContain("Martin | Riot#EUW");
	});
});
