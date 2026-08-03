import { describe, expect, it } from "vitest";
import type { MigrationItem, MigrationJob } from "../../src/database/schema/index.js";
import { Localizer } from "../../src/localization/formatter.js";
import { manualReviewMessage, migrationProgressBar, migrationStatusMessage } from "../../src/services/migration-status-presenter.js";

const i18n = new Localizer();
const job = {
	id: "job-1",
	guildId: "guild-1",
	status: "RUNNING",
	totalMembers: 100,
	processedMembers: 50,
	verifiedMembers: 35,
	unregisteredMembers: 10,
	pendingMembers: 6,
	failedMembers: 1,
	updatedAt: Date.now(),
} as MigrationJob;

describe("migration status presentation", () => {
	it("renders a German progress embed and rate-conscious controls", () => {
		const payload = migrationStatusMessage(job, [manualItem(0)], "admin-1", i18n);
		const embed = embedJson(payload.embeds?.[0]!);
		expect(embed.title).toBe("Registrierungsmigration – Status");
		expect(embed.description).toContain("50,0 %");
		expect(embed.description).toContain(migrationProgressBar(50, 100));
		expect(embed.footer?.text).toContain("30 Sekunden");
		expect(payload.components).toHaveLength(1);
	});

	it("paginates every manual-review member and explains duplicate conflicts", () => {
		const items = Array.from({ length: 9 }, (_, index) => manualItem(index));
		const first = manualReviewMessage(job, items, "admin-1", 0, i18n, new Map([["owner-1", "owner (owner-1)"]]));
		const second = manualReviewMessage(job, items, "admin-1", 1, i18n, new Map([["owner-1", "owner (owner-1)"]]));
		const firstEmbed = embedJson(first.embeds?.[0]!);
		const secondEmbed = embedJson(second.embeds?.[0]!);
		expect(firstEmbed.fields).toHaveLength(8);
		expect(secondEmbed.fields).toHaveLength(1);
		expect(firstEmbed.description).toContain("Insgesamt 9 Mitglieder");
		expect(firstEmbed.fields?.[0]?.value).toContain("bereits einem anderen Discord-Mitglied");
		expect(firstEmbed.fields?.[0]?.value).toContain("owner (owner-1)");
	});

	it("clamps the progress bar", () => {
		expect(migrationProgressBar(0, 100)).toBe("░".repeat(16));
		expect(migrationProgressBar(200, 100)).toBe("█".repeat(16));
	});
});

function manualItem(index: number): MigrationItem {
	return {
		id: `item-${index}`,
		jobId: job.id,
		sequence: index,
		guildId: job.guildId,
		userId: `user-${index}`,
		usernameSnapshot: `discord-user-${index}`,
		originalNickname: `Name ${index} | Riot#EUW`,
		state: "MANUAL_REVIEW",
		lastErrorCode: "DUPLICATE_PUUID_MANUAL_REVIEW",
		metadata: JSON.stringify({ conflictingUserId: "owner-1" }),
	} as MigrationItem;
}

function embedJson(embed: NonNullable<ReturnType<typeof migrationStatusMessage>["embeds"]>[number]) {
	return "toJSON" in embed ? embed.toJSON() : embed;
}
