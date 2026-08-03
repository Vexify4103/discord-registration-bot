import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/config/schema.js";
import { MigrationWorker } from "../../src/jobs/migration-worker.js";
import { memberFingerprint } from "../../src/services/migration-service.js";

describe("MigrationWorker", () => {
	it("keeps a visible-name member verified without Riot when the old Riot ID is not found", async () => {
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
			running: vi.fn().mockReturnValue(job),
			next: vi.fn().mockReturnValue(item),
			completeItem: vi.fn(),
			finishIfDone: vi.fn(),
		};
		const registrations = {
			setPendingMigration: vi.fn(),
			saveRegistered: vi.fn(),
			saveVerifiedWithoutRiot: vi.fn(),
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

		expect(registrations.saveVerifiedWithoutRiot).toHaveBeenCalledWith(
			expect.objectContaining({
				guildId: job.guildId,
				userId: member.id,
				displayName: "Martin",
				originalNickname: item.originalNickname,
				reason: "RIOT_NOT_FOUND",
			})
		);
		expect(migrations.completeItem).toHaveBeenCalledWith(item, "VERIFIED_NO_RIOT", "RIOT_NOT_FOUND");
		expect(registrations.setPendingMigration).not.toHaveBeenCalled();
		expect(registrations.unregister).not.toHaveBeenCalled();
		expect(registrations.saveRegistered).not.toHaveBeenCalled();
	});

	it("keeps a hidden-name member in manual review when the old Riot ID is not found", async () => {
		const member = {
			id: "user-2",
			user: { username: "HiddenDiscordName" },
			joinedTimestamp: 1_700_000_000_000,
			roles: { cache: new Map([["everyone", {}]]) },
		};
		const job = { id: "job-2", guildId: "guild-1", startedBy: "admin-1", status: "RUNNING" };
		const item = {
			id: "item-2",
			jobId: job.id,
			guildId: job.guildId,
			userId: member.id,
			category: "LEGACY_REGISTERED_HIDDEN_NAME",
			parsedDisplayName: null,
			parsedGameName: "OldRiotName",
			parsedTagLine: "EUW",
			originalNickname: "? | OldRiotName#EUW",
			snapshotFingerprint: memberFingerprint(member as never),
		};
		const migrations = {
			running: vi.fn().mockReturnValue(job),
			next: vi.fn().mockReturnValue(item),
			completeItem: vi.fn(),
			finishIfDone: vi.fn(),
		};
		const registrations = {
			setPendingMigration: vi.fn(),
			saveRegistered: vi.fn(),
			saveVerifiedWithoutRiot: vi.fn(),
			upsertJoined: vi.fn(),
			unregister: vi.fn(),
		};
		const worker = new MigrationWorker(
			{
				guilds: {
					fetch: vi.fn().mockResolvedValue({ members: { fetch: vi.fn().mockResolvedValue(member) } }),
				},
			} as never,
			{
				DISCORD_GUILD_ID: job.guildId,
				LEGACY_RIOT_ACCOUNT_ROUTES: ["europe"],
				DEFAULT_RIOT_ACCOUNT_ROUTE: "europe",
				DEFAULT_RIOT_PLATFORM_REGION: "EUW1",
			} as AppConfig,
			migrations as never,
			registrations as never,
			{ byRiotId: vi.fn().mockResolvedValue({ kind: "not-found" }) } as never,
			{ acquire: vi.fn().mockReturnValue(true), release: vi.fn() } as never,
			{ error: vi.fn() } as never
		);

		await worker.tick();

		expect(registrations.setPendingMigration).toHaveBeenCalledWith(job.guildId, member.id, member.user.username, member.joinedTimestamp, job.id, item.originalNickname);
		expect(migrations.completeItem).toHaveBeenCalledWith(item, "MANUAL_REVIEW", "RIOT_NOT_FOUND_MANUAL_REVIEW");
		expect(registrations.saveVerifiedWithoutRiot).not.toHaveBeenCalled();
		expect(registrations.unregister).not.toHaveBeenCalled();
	});

	it("does not process another member while the migration is paused", async () => {
		const migrations = {
			running: vi.fn().mockReturnValue(undefined),
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
