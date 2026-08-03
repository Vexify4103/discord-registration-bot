import type { NameVisibility } from "../types/domain.js";

export type AdministrativeNickname =
	| {
			kind: "REGISTERED";
			visibility: NameVisibility;
			displayName: string | null;
			gameName: string;
			tagLine: string;
	  }
	| {
			kind: "VERIFIED_NO_RIOT";
			displayName: string;
	  };

export class AdministrativeNicknameParser {
	parse(nickname: string | null): AdministrativeNickname | null {
		if (!nickname || nickname !== nickname.trim()) return null;
		const pipe = nickname.lastIndexOf(" | ");
		if (pipe <= 0) return null;
		const left = nickname.slice(0, pipe);
		const right = nickname.slice(pipe + 3);
		if (!left || left !== left.trim() || !right || right !== right.trim()) return null;
		if (right === "?#?") return left === "?" ? null : { kind: "VERIFIED_NO_RIOT", displayName: left };

		const hash = right.lastIndexOf("#");
		if (hash <= 0 || hash === right.length - 1) return null;
		const gameName = right.slice(0, hash);
		const tagLine = right.slice(hash + 1);
		if (gameName !== gameName.trim() || tagLine !== tagLine.trim() || gameName === "?" || tagLine === "?") return null;
		return {
			kind: "REGISTERED",
			visibility: left === "?" ? "HIDDEN" : "VISIBLE",
			displayName: left === "?" ? null : left,
			gameName,
			tagLine,
		};
	}
}
