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
		expect(i18n.t("migration.paused")).toContain("pausiert");
		expect(i18n.t("cleanup.removalDm")).toContain("sieben Tagen");
	});
	it("offers a German migration pause choice", () => {
		const setup = commandDefinitions(i18n)
			.map((command) => command.toJSON())
			.find((command) => command.name === "registration-setup");
		const mode = setup?.options?.find((option) => option.name === "mode");
		expect(mode && "choices" in mode ? mode.choices : []).toContainEqual({ name: "Pausieren", value: "pause" });
		expect(mode && "choices" in mode ? mode.choices : []).toContainEqual({ name: "Abbrechen", value: "cancel" });
		expect(mode && "choices" in mode ? mode.choices : []).toContainEqual({ name: "Unbekannte Formate", value: "unknown" });
		expect(mode && "choices" in mode ? mode.choices : []).toContainEqual({ name: "Manuelle Prüfungen", value: "manual-review" });
		expect(mode && "choices" in mode ? mode.choices : []).toContainEqual({ name: "Manuelle Regeln anwenden", value: "resolve-review" });
	});
	it("formats dates in German/Berlin", () => expect(i18n.date(new Date("2026-08-03T12:00:00Z"))).toMatch(/03\.08\.2026|03\.08\.26|3\. Aug\. 2026/));
	it("localizes command descriptions", () =>
		expect(
			commandDefinitions(i18n)
				.map((x) => x.toJSON())
				.map((x) => ("description" in x ? x.description : ""))
				.join(" ")
		).toContain("Registriere"));
	it("publishes the German member registration context command", () =>
		expect(commandDefinitions(i18n).map((command) => command.toJSON())).toContainEqual(expect.objectContaining({ name: "Mitglied registrieren", type: 2 })));
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
	it("uses production-facing mention help without configuration diagnostics", () => {
		expect(i18n.t("league.helpBody")).not.toContain("Mention-Befehle aktiviert");
		expect(i18n.t("league.mentionHelpBody")).toContain("Alle Funktionen");
		expect(i18n.t("league.mentionHelpBody")).not.toContain("aktiviert");
	});
});
