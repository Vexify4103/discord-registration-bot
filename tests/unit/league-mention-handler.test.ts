import { describe, expect, it } from "vitest";
import { parseLeagueMention } from "../../src/commands/league-mention-handler.js";

const botId = "100000000000000001";

describe("League mention commands", () => {
	it("supports Orianna-style English and German aliases", () => {
		expect(parseLeagueMention(`<@${botId}> profile`, botId)).toEqual({ subcommand: "profile" });
		expect(parseLeagueMention(`<@!${botId}> profil`, botId)).toEqual({ subcommand: "profile" });
		expect(parseLeagueMention(`<@${botId}> points`, botId)).toEqual({ subcommand: "mastery" });
	});
	it("parses champion charts and leaderboards", () => {
		expect(parseLeagueMention(`<@${botId}> stats Miss Fortune`, botId)).toEqual({ subcommand: "chart", champion: "Miss Fortune" });
		expect(parseLeagueMention(`<@${botId}> top Ahri`, botId)).toEqual({ subcommand: "top", topType: "champion", champion: "Ahri" });
		expect(parseLeagueMention(`<@${botId}> top gesamt`, botId)).toEqual({ subcommand: "top", topType: "total" });
	});
	it("ignores messages that do not start by addressing the bot", () => expect(parseLeagueMention(`profile <@${botId}>`, botId)).toBeUndefined());
	it("uses help for a bare mention and removes a target member mention", () => {
		expect(parseLeagueMention(`<@${botId}>`, botId)).toEqual({ subcommand: "help" });
		expect(parseLeagueMention(`<@${botId}> mastery <@100000000000000099>`, botId)).toEqual({ subcommand: "mastery" });
	});
});
