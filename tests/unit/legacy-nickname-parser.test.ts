import { describe, expect, it } from "vitest";
import { LegacyNicknameParser } from "../../src/parsers/legacy-nickname-parser.js";

describe("LegacyNicknameParser", () => {
	const parser = new LegacyNicknameParser();
	it.each([
		["? | ExamplePlayer#EUW", "LEGACY_REGISTERED_HIDDEN_NAME"],
		["Martin | ExamplePlayer#EUW", "LEGACY_REGISTERED_VISIBLE_NAME"],
		["Martin | ?#?", "LEGACY_VERIFIED_NO_RIOT"],
		["? | ?#?", "LEGACY_UNREGISTERED"],
		["ß Unregistriert", "LEGACY_UNREGISTERED"],
		["? Unregistriert", "LEGACY_UNREGISTERED"],
		["? | Unregistriert", "LEGACY_UNREGISTERED"],
		["arbitrary # text", "UNKNOWN_FORMAT"],
		["Name | #EUW", "UNKNOWN_FORMAT"],
		["Name | Game#", "UNKNOWN_FORMAT"],
	])("classifies %s", (nickname, category) => expect(parser.parse(nickname).category).toBe(category));
	it("parses rightmost pipe and final hash", () =>
		expect(parser.parse("A | B | Game#One#EUW")).toMatchObject({
			displayName: "A | B",
			gameName: "Game#One",
			tagLine: "EUW",
		}));
	it("never infers a hidden personal name", () =>
		expect(parser.parse("? | Spieler#EUW")).toMatchObject({
			nameVisibility: "HIDDEN",
			displayName: null,
		}));
	it("retains the known display name for members without a Riot account", () =>
		expect(parser.parse("Martin | ?#?")).toMatchObject({
			category: "LEGACY_VERIFIED_NO_RIOT",
			displayName: "Martin",
			nameVisibility: "VISIBLE",
			gameName: null,
			tagLine: null,
		}));
	it("supports configured whitespace variations", () => expect(new LegacyNicknameParser(true).parse("?    |   Unregistriert").category).toBe("LEGACY_UNREGISTERED"));
	it("handles Unicode", () =>
		expect(parser.parse("Mårtin | 例子#欧洲")).toMatchObject({
			displayName: "Mårtin",
			gameName: "例子",
			tagLine: "欧洲",
		}));
});
