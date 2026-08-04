import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { DatabaseContext } from "../database/client.js";
import { championMasteries, leagueProfiles, masterySnapshots, registrations, type LeagueProfile, type Registration } from "../database/schema/index.js";
import { highestRank } from "../services/rank-service.js";
import type { ChampionMastery, RankedEntry } from "../types/domain.js";

export interface LeagueSyncData {
	puuid: string;
	summonerId: string | null;
	summonerLevel: number;
	profileIconId: number;
	entries: RankedEntry[];
	masteries: ChampionMastery[];
}

export class LeagueRepository {
	constructor(private readonly database: DatabaseContext) {}

	profile(guildId: string, userId: string): LeagueProfile | undefined {
		return this.database.db
			.select()
			.from(leagueProfiles)
			.where(and(eq(leagueProfiles.guildId, guildId), eq(leagueProfiles.userId, userId)))
			.get();
	}

	masteries(guildId: string, userId: string, limit = 20) {
		return this.database.db
			.select()
			.from(championMasteries)
			.where(and(eq(championMasteries.guildId, guildId), eq(championMasteries.userId, userId)))
			.orderBy(desc(championMasteries.championPoints))
			.limit(limit)
			.all();
	}

	championLeaderboard(guildId: string, championId: number, limit = 10) {
		return this.database.db
			.select({ userId: championMasteries.userId, points: championMasteries.championPoints, level: championMasteries.championLevel })
			.from(championMasteries)
			.innerJoin(registrations, and(eq(registrations.guildId, championMasteries.guildId), eq(registrations.userId, championMasteries.userId)))
			.where(and(eq(championMasteries.guildId, guildId), eq(championMasteries.championId, championId), eq(registrations.isPresent, true)))
			.orderBy(desc(championMasteries.championPoints))
			.limit(limit)
			.all();
	}

	totalLeaderboard(guildId: string, limit = 10) {
		return this.database.db
			.select({ userId: leagueProfiles.userId, points: leagueProfiles.totalMasteryScore })
			.from(leagueProfiles)
			.innerJoin(registrations, and(eq(registrations.guildId, leagueProfiles.guildId), eq(registrations.userId, leagueProfiles.userId)))
			.where(and(eq(leagueProfiles.guildId, guildId), eq(registrations.isPresent, true)))
			.orderBy(desc(leagueProfiles.totalMasteryScore))
			.limit(limit)
			.all();
	}

	history(guildId: string, userId: string, championId: number, limit = 30) {
		return this.database.db
			.select()
			.from(masterySnapshots)
			.where(and(eq(masterySnapshots.guildId, guildId), eq(masterySnapshots.userId, userId), eq(masterySnapshots.championId, championId)))
			.orderBy(desc(masterySnapshots.capturedAt))
			.limit(limit)
			.all()
			.toReversed();
	}

	due(now: number, limit: number): Registration[] {
		return this.database.db
			.select({ registration: registrations })
			.from(registrations)
			.leftJoin(leagueProfiles, and(eq(leagueProfiles.guildId, registrations.guildId), eq(leagueProfiles.userId, registrations.userId)))
			.where(
				and(eq(registrations.status, "REGISTERED"), eq(registrations.isPresent, true), or(isNull(leagueProfiles.nextStatsSyncAt), lte(leagueProfiles.nextStatsSyncAt, now)))
			)
			.orderBy(asc(leagueProfiles.nextStatsSyncAt), asc(registrations.userId))
			.limit(limit)
			.all()
			.map((row) => row.registration);
	}

	save(guildId: string, userId: string, data: LeagueSyncData, nextSyncAt: number, now = Date.now()): LeagueProfile {
		const solo = data.entries.find((entry) => entry.queueType === "RANKED_SOLO_5x5");
		const flex = data.entries.find((entry) => entry.queueType === "RANKED_FLEX_SR");
		const effective = highestRank(data.entries);
		const totalMasteryScore = data.masteries.reduce((sum, item) => sum + item.championPoints, 0);
		this.database.sqlite.transaction(() => {
			const previous = this.profile(guildId, userId);
			if (previous && previous.puuidSnapshot !== data.puuid) {
				this.database.db
					.delete(masterySnapshots)
					.where(and(eq(masterySnapshots.guildId, guildId), eq(masterySnapshots.userId, userId)))
					.run();
				this.database.db
					.delete(championMasteries)
					.where(and(eq(championMasteries.guildId, guildId), eq(championMasteries.userId, userId)))
					.run();
			}
			this.database.db
				.insert(leagueProfiles)
				.values({
					guildId,
					userId,
					puuidSnapshot: data.puuid,
					summonerId: data.summonerId,
					summonerLevel: data.summonerLevel,
					profileIconId: data.profileIconId,
					...rankFields("solo", solo),
					...rankFields("flex", flex),
					effectiveTier: effective?.tier ?? null,
					effectiveDivision: effective?.rank ?? null,
					effectiveLeaguePoints: effective?.leaguePoints ?? null,
					totalMasteryScore,
					lastStatsSyncAt: now,
					nextStatsSyncAt: nextSyncAt,
					statsSyncStatus: "SUCCEEDED",
					statsSyncFailureCount: 0,
					lastStatsSyncErrorCode: null,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [leagueProfiles.guildId, leagueProfiles.userId],
					set: {
						puuidSnapshot: data.puuid,
						summonerId: data.summonerId,
						summonerLevel: data.summonerLevel,
						profileIconId: data.profileIconId,
						...rankFields("solo", solo),
						...rankFields("flex", flex),
						effectiveTier: effective?.tier ?? null,
						effectiveDivision: effective?.rank ?? null,
						effectiveLeaguePoints: effective?.leaguePoints ?? null,
						totalMasteryScore,
						lastStatsSyncAt: now,
						nextStatsSyncAt: nextSyncAt,
						statsSyncStatus: "SUCCEEDED",
						statsSyncFailureCount: 0,
						lastStatsSyncErrorCode: null,
						updatedAt: now,
					},
				})
				.run();
			for (const mastery of data.masteries) {
				const old = this.database.db
					.select({ points: championMasteries.championPoints })
					.from(championMasteries)
					.where(and(eq(championMasteries.guildId, guildId), eq(championMasteries.userId, userId), eq(championMasteries.championId, mastery.championId)))
					.get();
				this.database.db
					.insert(championMasteries)
					.values({ guildId, userId, ...mastery, updatedAt: now })
					.onConflictDoUpdate({
						target: [championMasteries.guildId, championMasteries.userId, championMasteries.championId],
						set: { championLevel: mastery.championLevel, championPoints: mastery.championPoints, lastPlayTime: mastery.lastPlayTime, updatedAt: now },
					})
					.run();
				if (!old || old.points !== mastery.championPoints)
					this.database.db
						.insert(masterySnapshots)
						.values({ id: crypto.randomUUID(), guildId, userId, championId: mastery.championId, championPoints: mastery.championPoints, capturedAt: now })
						.run();
			}
		})();
		return this.profile(guildId, userId)!;
	}

	fail(guildId: string, userId: string, code: string, nextSyncAt: number, now = Date.now()): void {
		const old = this.profile(guildId, userId);
		this.database.db
			.insert(leagueProfiles)
			.values({
				guildId,
				userId,
				puuidSnapshot: old?.puuidSnapshot ?? "pending",
				nextStatsSyncAt: nextSyncAt,
				statsSyncStatus: "FAILED_RETRYABLE",
				statsSyncFailureCount: (old?.statsSyncFailureCount ?? 0) + 1,
				lastStatsSyncErrorCode: code,
				createdAt: old?.createdAt ?? now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [leagueProfiles.guildId, leagueProfiles.userId],
				set: {
					nextStatsSyncAt: nextSyncAt,
					statsSyncStatus: "FAILED_RETRYABLE",
					statsSyncFailureCount: (old?.statsSyncFailureCount ?? 0) + 1,
					lastStatsSyncErrorCode: code,
					updatedAt: now,
				},
			})
			.run();
	}
}

function rankFields(prefix: "solo" | "flex", entry: RankedEntry | undefined) {
	const cap = prefix === "solo" ? "solo" : "flex";
	return {
		[`${cap}Tier`]: entry?.tier ?? null,
		[`${cap}Division`]: entry?.rank ?? null,
		[`${cap}LeaguePoints`]: entry?.leaguePoints ?? null,
		[`${cap}Wins`]: entry?.wins ?? null,
		[`${cap}Losses`]: entry?.losses ?? null,
	} as Record<string, string | number | null>;
}
