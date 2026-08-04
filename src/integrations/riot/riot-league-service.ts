import type { Logger } from "pino";
import type { ChampionMastery, RankedDivision, RankedEntry, RankedQueue } from "../../types/domain.js";
import { RiotRequestQueue } from "../../queues/riot-request-queue.js";
import { isRankedTier } from "../../services/rank-service.js";

export type LeagueStatsResult =
	| { kind: "success"; summonerId: null; summonerLevel: number; profileIconId: number; entries: RankedEntry[]; masteries: ChampionMastery[] }
	| { kind: "not-found" | "authentication-failure" | "temporary-failure"; code: string };

interface SummonerDto {
	summonerLevel?: unknown;
	profileIconId?: unknown;
}

export class RiotLeagueService {
	constructor(
		private readonly apiKey: string | undefined,
		private readonly queue: RiotRequestQueue,
		private readonly maxRetries: number,
		private readonly logger: Logger
	) {}

	async stats(platformRegion: string, puuid: string, priority = 35): Promise<LeagueStatsResult> {
		const host = platformRegion.toLowerCase();
		const summoner = await this.request<SummonerDto>(host, `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`, priority);
		if (summoner.kind !== "success") return summoner;
		const [league, mastery] = await Promise.all([
			this.request<unknown[]>(host, `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`, priority),
			this.request<unknown[]>(host, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}`, priority),
		]);
		if (league.kind !== "success") return league;
		if (mastery.kind !== "success") return mastery;
		if (!Array.isArray(league.data) || !Array.isArray(mastery.data)) return { kind: "temporary-failure", code: "INVALID_LEAGUE_RESPONSE" };
		return {
			kind: "success",
			summonerId: null,
			summonerLevel: numberOrZero(summoner.data.summonerLevel),
			profileIconId: numberOrZero(summoner.data.profileIconId),
			entries: league.data.flatMap(parseRankedEntry),
			masteries: mastery.data.flatMap(parseMastery),
		};
	}

	private request<T>(
		route: string,
		path: string,
		priority: number
	): Promise<{ kind: "success"; data: T } | { kind: "not-found" | "authentication-failure" | "temporary-failure"; code: string }> {
		return this.queue
			.run(() => this.perform<T>(route, path), priority)
			.catch((error: unknown) => ({
				kind: error instanceof Error && error.message === "RIOT_AUTHENTICATION_BLOCKED" ? "authentication-failure" : "temporary-failure",
				code: error instanceof Error ? error.message : "RIOT_QUEUE_FAILURE",
			}));
	}

	private async perform<T>(route: string, path: string) {
		if (!this.apiKey) return { kind: "authentication-failure" as const, code: "RIOT_KEY_MISSING" };
		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			try {
				const response = await fetch(`https://${route}.api.riotgames.com${path}`, { headers: { "X-Riot-Token": this.apiKey }, signal: AbortSignal.timeout(8_000) });
				if (response.status === 200) return { kind: "success" as const, data: (await response.json()) as T };
				if (response.status === 404) return { kind: "not-found" as const, code: "RIOT_NOT_FOUND" };
				if (response.status === 401 || response.status === 403) {
					this.queue.blockAuthentication();
					return { kind: "authentication-failure" as const, code: "RIOT_AUTHENTICATION" };
				}
				if (response.status === 429) {
					const seconds = Math.max(1, Number(response.headers.get("retry-after") ?? 1));
					this.queue.rateLimited(seconds);
					if (attempt === this.maxRetries) return { kind: "temporary-failure" as const, code: "RIOT_RATE_LIMITED" };
					await delay(seconds * 1000);
					continue;
				}
				if (response.status >= 500 && attempt < this.maxRetries) {
					await delay(500 * 2 ** attempt);
					continue;
				}
				return { kind: "temporary-failure" as const, code: `RIOT_HTTP_${response.status}` };
			} catch (error) {
				this.logger.warn({ err: error, attempt }, "Riot League request failed");
				if (attempt === this.maxRetries) return { kind: "temporary-failure" as const, code: "RIOT_NETWORK" };
				await delay(500 * 2 ** attempt);
			}
		}
		return { kind: "temporary-failure" as const, code: "RIOT_UNKNOWN" };
	}
}

function parseRankedEntry(value: unknown): RankedEntry[] {
	if (!value || typeof value !== "object") return [];
	const row = value as Record<string, unknown>;
	if (row.queueType !== "RANKED_SOLO_5x5" && row.queueType !== "RANKED_FLEX_SR") return [];
	if (!isRankedTier(row.tier) || !isDivision(row.rank)) return [];
	return [
		{
			queueType: row.queueType as RankedQueue,
			tier: row.tier,
			rank: row.rank,
			leaguePoints: numberOrZero(row.leaguePoints),
			wins: numberOrZero(row.wins),
			losses: numberOrZero(row.losses),
		},
	];
}

function parseMastery(value: unknown): ChampionMastery[] {
	if (!value || typeof value !== "object") return [];
	const row = value as Record<string, unknown>;
	if (!Number.isInteger(row.championId) || !Number.isInteger(row.championPoints)) return [];
	return [
		{
			championId: Number(row.championId),
			championLevel: numberOrZero(row.championLevel),
			championPoints: numberOrZero(row.championPoints),
			lastPlayTime: numberOrZero(row.lastPlayTime),
		},
	];
}

function isDivision(value: unknown): value is RankedDivision {
	return value === "IV" || value === "III" || value === "II" || value === "I";
}
const numberOrZero = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
