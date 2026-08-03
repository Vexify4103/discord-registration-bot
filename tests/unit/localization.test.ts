import { describe, expect, it } from "vitest";
import { commandDefinitions } from "../../src/commands/definitions.js";
import { de } from "../../src/localization/de.js";
import { Localizer } from "../../src/localization/formatter.js";
import { messageKeys } from "../../src/localization/keys.js";

describe("German localization", () => {
	const i18n = new Localizer();
	it("contains every typed key", () => expect(Object.keys(de).sort()).toEqual([...messageKeys].sort()));
	it("uses German registration messages", () => {
		expect(i18n.t("registration.success")).toContain("Registrierung erfolgreich");
		expect(i18n.t("registration.invalidOpggUrl")).toContain("ungültig");
		expect(i18n.t("registration.nameRequired")).toContain("Namen");
	});
	it("uses German migration buttons and cleanup message", () => {
		expect(i18n.t("migration.confirmButton")).toBe("Migration anwenden");
		expect(i18n.t("migration.cancelButton")).toBe("Abbrechen");
		expect(i18n.t("cleanup.removalDm")).toContain("sieben Tagen");
	});
	it("formats dates in German/Berlin", () => expect(i18n.date(new Date("2026-08-03T12:00:00Z"))).toMatch(/03\.08\.2026|03\.08\.26|3\. Aug\. 2026/));
	it("localizes command descriptions", () =>
		expect(
			commandDefinitions(i18n)
				.map((x) => x.toJSON().description)
				.join(" ")
		).toContain("Registriere"));
	it("places required Discord options before optional options", () => {
		for (const command of commandDefinitions(i18n).map((value) => value.toJSON())) {
			let optionalSeen = false;
			for (const option of command.options ?? []) {
				if (!option.required) optionalSeen = true;
				if (option.required) expect(optionalSeen, `${command.name}:${option.name}`).toBe(false);
			}
		}
	});
	it("prevents mention injection", () => expect(i18n.t("migration.previewBody", { total: "@everyone" })).not.toContain("@everyone"));
});
