import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseContext } from "../../src/database/client.js";
import { RegistrationRepository } from "../../src/repositories/registration-repository.js";

describe("RegistrationRepository", () => {
	let directory: string;
	let context: DatabaseContext;
	let repository: RegistrationRepository;
	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "registration-bot-test-"));
		context = createDatabase(join(directory, "test.sqlite"));
		migrate(context.db, {
			migrationsFolder: resolve("src/database/migrations"),
		});
		repository = new RegistrationRepository(context, 30);
	});
	afterEach(() => {
		context.sqlite.close();
		if (directory.startsWith(tmpdir())) rmSync(directory, { recursive: true, force: true });
	});
	const identity = {
		puuid: "puuid-1",
		gameName: "Game",
		tagLine: "EUW",
		riotId: "Game#EUW",
		platformRegion: "EUW1",
		accountRoutingGroup: "europe",
		opggUrl: "https://www.op.gg/lol/summoners/euw/Game-EUW",
	};
	it("stores visible registration and atomic reconciliation work", () => {
		repository.upsertJoined("1", "2", "discord", 1);
		const row = repository.saveRegistered({
			guildId: "1",
			userId: "2",
			actorUserId: "2",
			discordUsername: "discord",
			displayName: "Martin",
			nameVisibility: "VISIBLE",
			identity,
		});
		expect(row.displayName).toBe("Martin");
		expect(context.sqlite.prepare("select count(*) count from pending_operations").get()).toMatchObject({ count: 1 });
	});
	it("stores a verified member without Riot identity and excludes them from cleanup", () => {
		repository.upsertJoined("1", "2", "discord", 1);
		const row = repository.saveVerifiedWithoutRiot({
			guildId: "1",
			userId: "2",
			actorUserId: "9",
			discordUsername: "discord",
			displayName: "Martin",
			migrationJobId: "migration-1",
			originalNickname: "Martin | OldRiot#EUW",
			reason: "RIOT_NOT_FOUND",
			now: 10,
		});
		expect(row).toMatchObject({
			status: "VERIFIED_NO_RIOT",
			displayName: "Martin",
			nameVisibility: "VISIBLE",
			puuid: null,
			riotId: null,
			originalMigrationNickname: "Martin | OldRiot#EUW",
		});
		expect(repository.dueCleanup(Date.now())).toEqual([]);
		expect(context.sqlite.prepare("select count(*) count from pending_operations").get()).toMatchObject({ count: 1 });
	});
	it("rejects contradictory visibility/name combinations", () => {
		repository.upsertJoined("1", "2", "discord", 1);
		expect(() =>
			repository.saveRegistered({
				guildId: "1",
				userId: "2",
				actorUserId: "2",
				discordUsername: "discord",
				displayName: "Name",
				nameVisibility: "HIDDEN",
				identity,
			})
		).toThrow("HIDDEN_REQUIRES_NULL_NAME");
	});
	it("enforces visibility constraints inside SQLite", () => {
		repository.upsertJoined("1", "2", "discord", 1);
		repository.saveRegistered({
			guildId: "1",
			userId: "2",
			actorUserId: "2",
			discordUsername: "discord",
			displayName: "Martin",
			nameVisibility: "VISIBLE",
			identity,
		});
		expect(() => context.sqlite.prepare("update registrations set name_visibility='HIDDEN' where guild_id='1' and user_id='2'").run()).toThrow();
	});
	it("clears active display name and retains it on visible-to-hidden", () => {
		repository.upsertJoined("1", "2", "discord", 1);
		repository.saveRegistered({
			guildId: "1",
			userId: "2",
			actorUserId: "2",
			discordUsername: "discord",
			displayName: "Martin",
			nameVisibility: "VISIBLE",
			identity,
		});
		const row = repository.saveRegistered({
			guildId: "1",
			userId: "2",
			actorUserId: "2",
			discordUsername: "discord",
			displayName: null,
			nameVisibility: "HIDDEN",
			identity,
		});
		expect(row.displayName).toBeNull();
		expect(context.sqlite.prepare("select value from retained_registration_data").get()).toMatchObject({ value: "Martin" });
	});
	it("prevents duplicate PUUID without override", () => {
		for (const id of ["2", "3"]) repository.upsertJoined("1", id, `d${id}`, 1);
		repository.saveRegistered({
			guildId: "1",
			userId: "2",
			actorUserId: "2",
			discordUsername: "d2",
			displayName: "A",
			nameVisibility: "VISIBLE",
			identity,
		});
		expect(() =>
			repository.saveRegistered({
				guildId: "1",
				userId: "3",
				actorUserId: "9",
				discordUsername: "d3",
				displayName: null,
				nameVisibility: "HIDDEN",
				identity,
			})
		).toThrow();
		expect(() =>
			repository.saveRegistered({
				guildId: "1",
				userId: "3",
				actorUserId: "9",
				discordUsername: "d3",
				displayName: null,
				nameVisibility: "HIDDEN",
				identity,
				overrideDuplicate: true,
				overrideAuthorized: true,
			})
		).not.toThrow();
	});
	it("restores a registered rejoin inside retention", () => {
		const now = Date.now();
		repository.upsertJoined("1", "2", "discord", now);
		repository.saveRegistered({
			guildId: "1",
			userId: "2",
			actorUserId: "2",
			discordUsername: "discord",
			displayName: null,
			nameVisibility: "HIDDEN",
			identity,
		});
		repository.markLeft("1", "2", now + 10);
		expect(repository.upsertJoined("1", "2", "discord2", now + 20)).toMatchObject({
			status: "REGISTERED",
			nameVisibility: "HIDDEN",
			displayName: null,
			isPresent: true,
		});
	});
});
