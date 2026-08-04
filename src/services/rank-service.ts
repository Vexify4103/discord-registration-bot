import type { RankedEntry, RankedTier } from "../types/domain.js";

const tierOrder: Record<RankedTier, number> = {
	IRON: 0,
	BRONZE: 1,
	SILVER: 2,
	GOLD: 3,
	PLATINUM: 4,
	EMERALD: 5,
	DIAMOND: 6,
	MASTER: 7,
	GRANDMASTER: 8,
	CHALLENGER: 9,
};
const divisionOrder = { IV: 0, III: 1, II: 2, I: 3 } as const;

export function highestRank(entries: readonly RankedEntry[]): RankedEntry | undefined {
	return entries.filter((entry) => entry.queueType === "RANKED_SOLO_5x5" || entry.queueType === "RANKED_FLEX_SR").toSorted((a, b) => rankValue(b) - rankValue(a))[0];
}

export function rankValue(entry: RankedEntry): number {
	return tierOrder[entry.tier] * 1_000_000 + divisionOrder[entry.rank] * 10_000 + entry.leaguePoints;
}

export function isRankedTier(value: unknown): value is RankedTier {
	return typeof value === "string" && value in tierOrder;
}
