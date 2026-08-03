import type { LegacyCategory, NameVisibility } from "../types/domain.js";

export interface LegacyParseResult {
	category: LegacyCategory;
	originalNickname: string | null;
	displayName: string | null;
	gameName: string | null;
	tagLine: string | null;
	nameVisibility: NameVisibility | null;
	unregisteredPattern?: "NAME_UNKNOWN" | "SHARP_S" | "QUESTION_SPACE" | "QUESTION_PIPE" | "CURRENT_TEMPLATE";
}

export class LegacyNicknameParser {
	constructor(private readonly allowWhitespaceVariations = false) {}

	parse(nickname: string | null): LegacyParseResult {
		const originalNickname = nickname;
		if (!nickname) return this.unknown(originalNickname);
		const value = nickname.trim();
		const noRiotPattern = this.allowWhitespaceVariations ? /^(.+?)\s*\|\s*\?\s*#\s*\?$/u : /^(.+) \| \?#\?$/u;
		const noRiotMatch = noRiotPattern.exec(value);
		if (noRiotMatch) {
			const displayName = noRiotMatch[1]?.trim();
			if (displayName && displayName !== "?")
				return {
					category: "LEGACY_VERIFIED_NO_RIOT",
					originalNickname,
					displayName,
					gameName: null,
					tagLine: null,
					nameVisibility: "VISIBLE",
				};
		}
		const literalPatterns: Array<[RegExp, LegacyParseResult["unregisteredPattern"]]> = [
			[this.allowWhitespaceVariations ? /^\?\s*\|\s*\?\s*#\s*\?$/u : /^\? \| \?#\?$/u, "NAME_UNKNOWN"],
			[this.allowWhitespaceVariations ? /^ß\s*Unregistriert$/u : /^ß Unregistriert$/u, "SHARP_S"],
			[this.allowWhitespaceVariations ? /^\?\s*Unregistriert$/u : /^\? Unregistriert$/u, "QUESTION_SPACE"],
			[this.allowWhitespaceVariations ? /^\?\s*\|\s*Unregistriert$/u : /^\? \| Unregistriert$/u, "QUESTION_PIPE"],
			[this.allowWhitespaceVariations ? /^Unregistriert\s*\|\s*.+$/u : /^Unregistriert \| .+$/u, "CURRENT_TEMPLATE"],
		];
		for (const [pattern, unregisteredPattern] of literalPatterns)
			if (pattern.test(value))
				return {
					category: "LEGACY_UNREGISTERED",
					originalNickname,
					displayName: null,
					gameName: null,
					tagLine: null,
					nameVisibility: null,
					unregisteredPattern: unregisteredPattern!,
				};
		if (!value.includes("|")) {
			const hash = value.lastIndexOf("#");
			if (hash > 0 && hash < value.length - 1) {
				const rawGameName = value.slice(0, hash);
				const rawTagLine = value.slice(hash + 1);
				if (rawGameName === rawGameName.trim() && rawTagLine === rawTagLine.trim() && rawGameName !== "?" && rawTagLine !== "?")
					return {
						category: "LEGACY_REGISTERED_HIDDEN_NAME",
						originalNickname,
						displayName: null,
						gameName: rawGameName,
						tagLine: rawTagLine,
						nameVisibility: "HIDDEN",
					};
			}
		}
		const pipe = value.lastIndexOf("|");
		if (pipe < 0) return this.unknown(originalNickname);
		const left = value.slice(0, pipe).trim();
		const right = value.slice(pipe + 1).trim();
		const hash = right.lastIndexOf("#");
		if (!left || hash <= 0 || hash === right.length - 1) return this.unknown(originalNickname);
		const gameName = right.slice(0, hash).trim();
		const tagLine = right.slice(hash + 1).trim();
		if (!gameName || !tagLine || (gameName === "?" && tagLine === "?")) return this.unknown(originalNickname);
		if (left === "?")
			return {
				category: "LEGACY_REGISTERED_HIDDEN_NAME",
				originalNickname,
				displayName: null,
				gameName,
				tagLine,
				nameVisibility: "HIDDEN",
			};
		return {
			category: "LEGACY_REGISTERED_VISIBLE_NAME",
			originalNickname,
			displayName: left,
			gameName,
			tagLine,
			nameVisibility: "VISIBLE",
		};
	}

	private unknown(originalNickname: string | null): LegacyParseResult {
		return {
			category: "UNKNOWN_FORMAT",
			originalNickname,
			displayName: null,
			gameName: null,
			tagLine: null,
			nameVisibility: null,
		};
	}
}
