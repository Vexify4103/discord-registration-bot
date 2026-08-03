import { de } from "./de.js";
import type { MessageKey, MessageValues } from "./keys.js";

export class Localizer {
	readonly locale: string;
	readonly timeZone: string;

	constructor(locale = "de-DE", timeZone = "Europe/Berlin") {
		this.locale = locale;
		this.timeZone = timeZone;
	}

	t(key: MessageKey, values: MessageValues = {}): string {
		const template = de[key];
		if (!template) {
			if (process.env.NODE_ENV !== "production") throw new Error(`Missing localization key: ${key}`);
			return de["common.unexpectedError"];
		}
		return template.replace(/\{(\w+)\}/g, (_, name: string) => this.safe(values[name]));
	}

	date(value: Date | number | null | undefined): string {
		if (value == null) return "–";
		return new Intl.DateTimeFormat(this.locale, {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: this.timeZone,
		}).format(value instanceof Date ? value : new Date(value));
	}

	private safe(value: MessageValues[string]): string {
		if (value == null) return "–";
		const formatted = value instanceof Date ? this.date(value) : String(value);
		return formatted.replace(/@/g, "@\u200b").slice(0, 1000);
	}
}
