import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseContext } from "../../src/database/client.js";
import { LeagueRepository } from "../../src/repositories/league-repository.js";
import { RegistrationRepository } from "../../src/repositories/registration-repository.js";

describe("LeagueRepository", () => {
	let directory: string;
	let context: DatabaseContext;
	let league: LeagueRepository;
	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "league-bot-test-"));
		context = createDatabase(join(directory, "test.sqlite"));
		migrate(context.db, { migrationsFolder: resolve("src/database/migrations") });
		league = new LeagueRepository(context);
		const registrations = new RegistrationRepository(context, 30);
		registrations.upsertJoined("1", "2", "discord", 1);
		registrations.saveRegistered({
			guildId: "1",
			userId: "2",
			actorUserId: "2",
			discordUsername: "discord",
			displayName: "Martin",
			nameVisibility: "VISIBLE",
			identity: { puuid: "p", gameName: "Game", tagLine: "EUW", riotId: "Game#EUW", platformRegion: "EUW1", accountRoutingGroup: "europe", opggUrl: "https://op.gg" },
			now: 2,
		});
	});
	afterEach(() => {
		context.sqlite.close();
		if (directory.startsWith(tmpdir())) rmSync(directory, { recursive: true, force: true });
	});
	it("stores non-TFT ranks and mastery history snapshots", () => {
		league.save(
			"1",
			"2",
			{
				puuid: "p",
				summonerId: "s",
				summonerLevel: 50,
				profileIconId: 1,
				entries: [
					{ queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "I", leaguePoints: 50, wins: 10, losses: 8 },
					{ queueType: "RANKED_FLEX_SR", tier: "PLATINUM", rank: "IV", leaguePoints: 1, wins: 4, losses: 2 },
				],
				masteries: [{ championId: 1, championLevel: 7, championPoints: 1000, lastPlayTime: 10 }],
			},
			100,
			10
		);
		expect(league.profile("1", "2")?.effectiveTier).toBe("PLATINUM");
		league.save(
			"1",
			"2",
			{
				puuid: "p",
				summonerId: "s",
				summonerLevel: 50,
				profileIconId: 1,
				entries: [],
				masteries: [{ championId: 1, championLevel: 7, championPoints: 1200, lastPlayTime: 20 }],
			},
			200,
			20
		);
		expect(league.history("1", "2", 1)).toHaveLength(2);
	});
});
