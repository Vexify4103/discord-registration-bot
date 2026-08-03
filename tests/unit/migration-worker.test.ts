import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/config/schema.js";
import { MigrationWorker } from "../../src/jobs/migration-worker.js";
import { DuplicatePuuidError } from "../../src/repositories/registration-repository.js";
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

	it("marks a hidden-name member unregistered when the old Riot ID is not found", async () => {
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

		expect(registrations.upsertJoined).toHaveBeenCalledWith(job.guildId, member.id, member.user.username, member.joinedTimestamp);
		expect(registrations.unregister).toHaveBeenCalledWith(job.guildId, member.id, job.startedBy, expect.any(Number));
		expect(migrations.completeItem).toHaveBeenCalledWith(item, "UNREGISTERED", "RIOT_NOT_FOUND_UNREGISTERED");
		expect(registrations.saveVerifiedWithoutRiot).not.toHaveBeenCalled();
		expect(registrations.setPendingMigration).not.toHaveBeenCalled();
	});

	it("clones the first registration for a duplicate Riot PUUID", async () => {
		const member = {
			id: "user-duplicate",
			user: { username: "DuplicateDiscordName" },
			joinedTimestamp: 1_700_000_000_000,
			roles: { cache: new Map([["everyone", {}]]) },
		};
		const job = { id: "job-duplicate", guildId: "guild-1", startedBy: "admin-1", status: "RUNNING" };
		const item = {
			id: "item-duplicate",
			jobId: job.id,
			guildId: job.guildId,
			userId: member.id,
			category: "LEGACY_REGISTERED_VISIBLE_NAME",
			parsedDisplayName: "Laster",
			parsedGameName: "Hebi Shinobi",
			parsedTagLine: "EUW",
			originalNickname: "Laster | Hebi Shinobi#EUW",
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
			get: vi.fn().mockReturnValue({
				status: "REGISTERED",
				displayName: "Lukas",
				nameVisibility: "VISIBLE",
				puuid: "shared-puuid",
				gameName: "Hebi Shinobi",
				tagLine: "EUW",
				riotId: "Hebi Shinobi#EUW",
				platformRegion: "EUW1",
				accountRoutingGroup: "europe",
				opggUrl: "https://www.op.gg/lol/summoners/euw/Hebi%20Shinobi-EUW",
			}),
			saveRegistered: vi.fn().mockImplementationOnce(() => {
				throw new DuplicatePuuidError("existing-owner");
			}),
			saveVerifiedWithoutRiot: vi.fn(),
			upsertJoined: vi.fn(),
			unregister: vi.fn(),
		};
		const logger = { error: vi.fn(), warn: vi.fn() };
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
			{ byRiotId: vi.fn().mockResolvedValue({ kind: "success", account: { puuid: "shared-puuid", gameName: "Hebi Shinobi", tagLine: "EUW" } }) } as never,
			{ acquire: vi.fn().mockReturnValue(true), release: vi.fn() } as never,
			logger as never
		);

		await worker.tick();

		expect(registrations.saveRegistered).toHaveBeenLastCalledWith(
			expect.objectContaining({
				displayName: "Lukas",
				nameVisibility: "VISIBLE",
				overrideDuplicate: true,
				overrideAuthorized: true,
				identity: expect.objectContaining({ puuid: "shared-puuid", riotId: "Hebi Shinobi#EUW" }),
			})
		);
		expect(registrations.setPendingMigration).not.toHaveBeenCalled();
		expect(migrations.completeItem).toHaveBeenCalledWith(item, "VERIFIED");
		expect(logger.error).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
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
