import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RiotLeagueService } from "../../src/integrations/riot/riot-league-service.js";
import { RiotRequestQueue } from "../../src/queues/riot-request-queue.js";

describe("RiotLeagueService", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("loads ranked and mastery data while excluding TFT", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: "summoner", summonerLevel: 100, profileIconId: 5 }), { status: 200 }))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify([
						{ queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "I", leaguePoints: 20, wins: 10, losses: 5 },
						{ queueType: "RANKED_TFT", tier: "CHALLENGER", rank: "I", leaguePoints: 999, wins: 10, losses: 1 },
					]),
					{ status: 200 }
				)
			)
			.mockResolvedValueOnce(new Response(JSON.stringify([{ championId: 1, championLevel: 7, championPoints: 1234, lastPlayTime: 9 }]), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const result = await new RiotLeagueService("key", new RiotRequestQueue(0), 0, pino({ level: "silent" })).stats("EUW1", "puuid");
		expect(result).toMatchObject({ kind: "success", entries: [{ queueType: "RANKED_SOLO_5x5", tier: "GOLD" }], masteries: [{ championId: 1, championPoints: 1234 }] });
		expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
			"https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/puuid",
			"https://euw1.api.riotgames.com/lol/league/v4/entries/by-summoner/summoner",
			"https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/puuid",
		]);
	});
});
