import { describe, expect, it } from "vitest";
import { NicknameService } from "../../src/services/nickname-service.js";

describe("NicknameService", () => {
	const service = new NicknameService();
	it("formats visible registrations", () =>
		expect(
			service.registered({
				visibility: "VISIBLE",
				displayName: "Martin",
				gameName: "ExamplePlayer",
				tagLine: "EUW",
			})
		).toBe("Martin | ExamplePlayer#EUW"));
	it("formats hidden registrations as Riot ID only", () => {
		const result = service.registered({
			visibility: "HIDDEN",
			displayName: null,
			gameName: "ExamplePlayer",
			tagLine: "EUW",
		});
		expect(result).toBe("ExamplePlayer#EUW");
		expect(result).not.toContain("? |");
	});
	it("formats verified members without Riot using the known display name", () => expect(service.verifiedWithoutRiot("Martin")).toBe("Martin | ?#?"));
	it("falls back from visible format to complete Riot ID", () => {
		const gameName = "A".repeat(27);
		expect(
			service.registered({
				visibility: "VISIBLE",
				displayName: "Martin",
				gameName,
				tagLine: "EUW",
			})
		).toBe(`${gameName}#EUW`);
	});
	it("preserves tag and truncates only game name", () =>
		expect(
			service.registered({
				visibility: "HIDDEN",
				displayName: null,
				gameName: "SehrLangerSpielernameDerNichtPasst",
				tagLine: "EUW",
			})
		).toMatch(/#EUW$/));
	it("does not split grapheme clusters", () =>
		expect([...new Intl.Segmenter("de-DE", { granularity: "grapheme" }).segment(service.unregistered("👨‍👩‍👧‍👦".repeat(30)))].length).toBeLessThanOrEqual(32));
	it("falls back safely for an impossible template", () => expect(new NicknameService("X".repeat(40) + "{username}").unregistered("name")).toBe("Unregistriert"));
});
