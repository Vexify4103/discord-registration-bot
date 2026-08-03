import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/config/schema.js";
import { MigrationWorker } from "../../src/jobs/migration-worker.js";
import { memberFingerprint } from "../../src/services/migration-service.js";

describe("MigrationWorker", () => {
	it("routes a Riot account not found result to manual review without unregistering the member", async () => {
		const member = {
			id: "user-1",
			user: { username: "DiscordName" },
			joinedTimestamp: 1_700_000_000_000,
			roles: { cache: new Map([["everyone", {}]]) },
		};
		const job = { id: "job-1", guildId: "guild-1", startedBy: "admin-1", status: "RUNNING" };
		const item = {
			id: "item-1",
			jobId: job.id,
			guildId: job.guildId,
			userId: member.id,
			category: "LEGACY_REGISTERED_VISIBLE_NAME",
			parsedDisplayName: "Martin",
			parsedGameName: "OldRiotName",
			parsedTagLine: "EUW",
			originalNickname: "Martin | OldRiotName#EUW",
			snapshotFingerprint: memberFingerprint(member as never),
		};
		const migrations = {
			latest: vi.fn().mockReturnValue(job),
			next: vi.fn().mockReturnValue(item),
			completeItem: vi.fn(),
			finishIfDone: vi.fn(),
		};
		const registrations = {
			setPendingMigration: vi.fn(),
			saveRegistered: vi.fn(),
			upsertJoined: vi.fn(),
			unregister: vi.fn(),
		};
		const riot = { byRiotId: vi.fn().mockResolvedValue({ kind: "not-found" }) };
		const leases = { acquire: vi.fn().mockReturnValue(true), release: vi.fn() };
		const client = {
			guilds: {
				fetch: vi.fn().mockResolvedValue({ members: { fetch: vi.fn().mockResolvedValue(member) } }),
			},
		};
		const config = {
			DISCORD_GUILD_ID: job.guildId,
			LEGACY_RIOT_ACCOUNT_ROUTES: ["europe"],
			DEFAULT_RIOT_ACCOUNT_ROUTE: "europe",
			DEFAULT_RIOT_PLATFORM_REGION: "EUW1",
		} as AppConfig;
		const logger = { error: vi.fn() };

		const worker = new MigrationWorker(client as never, config, migrations as never, registrations as never, riot as never, leases as never, logger as never);
		await worker.tick();

		expect(registrations.setPendingMigration).toHaveBeenCalledWith(job.guildId, member.id, member.user.username, member.joinedTimestamp, job.id, item.originalNickname);
		expect(migrations.completeItem).toHaveBeenCalledWith(item, "MANUAL_REVIEW", "RIOT_NOT_FOUND_MANUAL_REVIEW");
		expect(registrations.unregister).not.toHaveBeenCalled();
		expect(registrations.saveRegistered).not.toHaveBeenCalled();
	});

	it("does not process another member while the migration is paused", async () => {
		const migrations = {
			latest: vi.fn().mockReturnValue({ id: "job-1", status: "PAUSED" }),
			next: vi.fn(),
		};
		const leases = { acquire: vi.fn(), release: vi.fn() };
		const worker = new MigrationWorker(
			{} as never,
			{ DISCORD_GUILD_ID: "guild-1" } as AppConfig,
			migrations as never,
			{} as never,
			{} as never,
			leases as never,
			{ error: vi.fn() } as never
		);

		await worker.tick();

		expect(migrations.next).not.toHaveBeenCalled();
		expect(leases.acquire).not.toHaveBeenCalled();
	});
});
