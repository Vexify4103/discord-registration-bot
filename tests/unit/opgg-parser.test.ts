import { describe, expect, it } from "vitest";
import { OpggParser } from "../../src/parsers/opgg-parser.js";

describe("OpggParser", () => {
	const parser = new OpggParser();
	it("accepts a supported League profile", () =>
		expect(parser.parse("https://www.op.gg/lol/summoners/euw/ExamplePlayer-EUW")).toMatchObject({
			gameName: "ExamplePlayer",
			tagLine: "EUW",
			platformRegion: "EUW1",
			accountRoutingGroup: "europe",
		}));
	it("normalizes platform slugs without guessing from platform codes", () =>
		expect(parser.parse("https://op.gg/lol/summoners/eune/Player-EUNE")).toMatchObject({
			platformRegion: "EUN1",
			normalizedUrl: "https://www.op.gg/lol/summoners/eune/Player-EUNE",
		}));
	it.each([
		"http://op.gg/lol/summoners/euw/A-EUW",
		"https://evil-op.gg/lol/summoners/euw/A-EUW",
		"https://op.gg/valorant/profile/A-EUW",
		"https://op.gg/lol/summoners/euw/A-EUW?q=x",
		"https://op.gg/lol/summoners/unknown/A-EUW",
	])("rejects %s", (url) => expect(parser.parse(url)).toBeNull());
});
