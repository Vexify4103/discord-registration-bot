import type { NameVisibility } from "../types/domain.js";

const MAX_NICKNAME_LENGTH = 32;

export class NicknameService {
	private readonly segmenter = new Intl.Segmenter("de-DE", {
		granularity: "grapheme",
	});

	constructor(private readonly unregisteredTemplate = "Unregistriert | {username}") {
		if (!unregisteredTemplate.includes("{username}")) throw new Error("INVALID_UNREGISTERED_TEMPLATE");
	}

	registered(input: { visibility: NameVisibility; displayName: string | null; gameName: string; tagLine: string }): string {
		const riotId = `${input.gameName}#${input.tagLine}`;
		if (input.visibility === "HIDDEN") return this.riotIdOnly(input.gameName, input.tagLine);
		if (!input.displayName?.trim()) throw new Error("VISIBLE_REQUIRES_NAME");
		const suffix = ` | ${riotId}`;
		const available = MAX_NICKNAME_LENGTH - this.length(suffix);
		if (available >= 1) {
			const name = this.truncate(input.displayName.trim(), available);
			const result = `${name}${suffix}`;
			if (name && this.length(result) <= MAX_NICKNAME_LENGTH) return result;
		}
		return this.riotIdOnly(input.gameName, input.tagLine);
	}

	verifiedWithoutRiot(displayName: string): string {
		const name = displayName.trim();
		if (!name) throw new Error("VERIFIED_NO_RIOT_REQUIRES_NAME");
		const suffix = " | ?#?";
		const available = MAX_NICKNAME_LENGTH - this.length(suffix);
		return `${this.truncate(name, available)}${suffix}`;
	}

	unregistered(username: string): string {
		const fixed = this.unregisteredTemplate.replace("{username}", "");
		const available = MAX_NICKNAME_LENGTH - this.length(fixed);
		if (available <= 0) return "Unregistriert";
		const safeUsername = this.truncate(username.trim(), available);
		const result = this.unregisteredTemplate.replace("{username}", safeUsername);
		return safeUsername && this.length(result) <= MAX_NICKNAME_LENGTH ? result : "Unregistriert";
	}

	private riotIdOnly(gameName: string, tagLine: string): string {
		const suffix = `#${tagLine}`;
		if (this.length(`${gameName}${suffix}`) <= MAX_NICKNAME_LENGTH) return `${gameName}${suffix}`;
		const available = MAX_NICKNAME_LENGTH - this.length(suffix);
		if (available >= 1) return `${this.truncate(gameName, available)}${suffix}`;
		return "Registriert";
	}

	private truncate(value: string, limit: number): string {
		if (limit <= 0) return "";
		return [...this.segmenter.segment(value)]
			.slice(0, limit)
			.map((part) => part.segment)
			.join("");
	}

	private length(value: string): number {
		return [...this.segmenter.segment(value)].length;
	}
}
