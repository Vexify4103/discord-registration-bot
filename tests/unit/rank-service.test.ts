import { describe, expect, it } from "vitest";
import { highestRank } from "../../src/services/rank-service.js";

describe("rank selection", () => {
	it("uses the higher of Solo/Duo and Flex", () => {
		const result = highestRank([
			{ queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "I", leaguePoints: 80, wins: 1, losses: 1 },
			{ queueType: "RANKED_FLEX_SR", tier: "PLATINUM", rank: "IV", leaguePoints: 0, wins: 1, losses: 1 },
		]);
		expect(result?.tier).toBe("PLATINUM");
	});
});
