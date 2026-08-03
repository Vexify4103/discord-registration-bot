import { describe, expect, it } from "vitest";
import { AdministrativeNicknameParser } from "../../src/parsers/administrative-nickname-parser.js";

describe("AdministrativeNicknameParser", () => {
	const parser = new AdministrativeNicknameParser();

	it("accepts the three administrative nickname forms", () => {
		expect(parser.parse("Martin | ExamplePlayer#EUW")).toEqual({
			kind: "REGISTERED",
			visibility: "VISIBLE",
			displayName: "Martin",
			gameName: "ExamplePlayer",
			tagLine: "EUW",
		});
		expect(parser.parse("? | ExamplePlayer#EUW")).toEqual({
			kind: "REGISTERED",
			visibility: "HIDDEN",
			displayName: null,
			gameName: "ExamplePlayer",
			tagLine: "EUW",
		});
		expect(parser.parse("Martin | ?#?")).toEqual({ kind: "VERIFIED_NO_RIOT", displayName: "Martin" });
	});

	it.each([null, "ExamplePlayer#EUW", "? | ?#?", "Martin|ExamplePlayer#EUW", "Martin | ExamplePlayer", "Martin | ExamplePlayer#?"])("rejects unsupported form %s", (nickname) =>
		expect(parser.parse(nickname)).toBeNull()
	);
});
