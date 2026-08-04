import { mongoCollections, type MongoDatabaseContext } from "../../database/mongo-client.js";
import type { ChampionMasteryRow, LeagueProfile, Registration } from "../../database/schema/index.js";
import { highestRank } from "../../services/rank-service.js";
import type { ChampionMastery, RankedEntry } from "../../types/domain.js";
import type { LeagueSyncData } from "../league-repository.js";
import { withoutMongoId, withoutMongoIds } from "./helpers.js";

export interface MasterySnapshotDocument {
	id: string;
	guildId: string;
	userId: string;
	championId: number;
	championPoints: number;
	delta: number;
	capturedAt: number;
	capturedAtDate: Date;
}

export class LeagueRepository {
	constructor(private readonly database: MongoDatabaseContext) {}

	async profile(guildId: string, userId: string): Promise<LeagueProfile | undefined> {
		return withoutMongoId(await this.database.collection<LeagueProfile>(mongoCollections.leagueProfiles).findOne({ guildId, userId }));
	}

	async masteries(guildId: string, userId: string, limit = 20): Promise<ChampionMasteryRow[]> {
		return withoutMongoIds(
			await this.database.collection<ChampionMasteryRow>(mongoCollections.championMasteries).find({ guildId, userId }).sort({ championPoints: -1 }).limit(limit).toArray()
		);
	}

	async championLeaderboard(guildId: string, championId: number, limit = 10): Promise<Array<{ userId: string; points: number; level: number }>> {
		return this.database
			.collection<ChampionMasteryRow>(mongoCollections.championMasteries)
			.aggregate<{ userId: string; points: number; level: number }>([
				{ $match: { guildId, championId } },
				{
					$lookup: {
						from: mongoCollections.registrations,
						let: { guildId: "$guildId", userId: "$userId" },
						pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$guildId", "$$guildId"] }, { $eq: ["$userId", "$$userId"] }] }, isPresent: true } }],
						as: "registration",
					},
				},
				{ $match: { "registration.0": { $exists: true } } },
				{ $sort: { championPoints: -1 } },
				{ $limit: limit },
				{ $project: { _id: 0, userId: 1, points: "$championPoints", level: "$championLevel" } },
			])
			.toArray();
	}

	async totalLeaderboard(guildId: string, limit = 10): Promise<Array<{ userId: string; points: number }>> {
		return this.database
			.collection<LeagueProfile>(mongoCollections.leagueProfiles)
			.aggregate<{ userId: string; points: number }>([
				{ $match: { guildId } },
				{
					$lookup: {
						from: mongoCollections.registrations,
						let: { guildId: "$guildId", userId: "$userId" },
						pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$guildId", "$$guildId"] }, { $eq: ["$userId", "$$userId"] }] }, isPresent: true } }],
						as: "registration",
					},
				},
				{ $match: { "registration.0": { $exists: true } } },
				{ $sort: { totalMasteryScore: -1 } },
				{ $limit: limit },
				{ $project: { _id: 0, userId: 1, points: "$totalMasteryScore" } },
			])
			.toArray();
	}

	async history(guildId: string, userId: string, championId: number, limit = 30): Promise<MasterySnapshotDocument[]> {
		const rows = withoutMongoIds(
			await this.database
				.collection<MasterySnapshotDocument>(mongoCollections.masterySnapshots)
				.find({ guildId, userId, championId })
				.sort({ capturedAt: -1 })
				.limit(limit)
				.toArray()
		);
		return rows.reverse();
	}

	async due(now: number, limit: number): Promise<Registration[]> {
		return this.database
			.collection<Registration>(mongoCollections.registrations)
			.aggregate<Registration>([
				{ $match: { status: "REGISTERED", isPresent: true } },
				{
					$lookup: {
						from: mongoCollections.leagueProfiles,
						let: { guildId: "$guildId", userId: "$userId" },
						pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$guildId", "$$guildId"] }, { $eq: ["$userId", "$$userId"] }] } } }],
						as: "profile",
					},
				},
				{ $set: { profile: { $first: "$profile" } } },
				{ $match: { $or: [{ profile: null }, { "profile.nextStatsSyncAt": { $lte: now } }] } },
				{ $sort: { "profile.nextStatsSyncAt": 1, userId: 1 } },
				{ $limit: limit },
				{ $unset: ["_id", "profile"] },
			])
			.toArray();
	}

	async save(guildId: string, userId: string, data: LeagueSyncData, nextSyncAt: number, now = Date.now()): Promise<LeagueProfile> {
		const solo = data.entries.find((entry) => entry.queueType === "RANKED_SOLO_5x5");
		const flex = data.entries.find((entry) => entry.queueType === "RANKED_FLEX_SR");
		const effective = highestRank(data.entries);
		const totalMasteryScore = data.masteries.reduce((sum, item) => sum + item.championPoints, 0);
		await this.database.transaction(async (session) => {
			const profiles = this.database.collection<LeagueProfile>(mongoCollections.leagueProfiles);
			const masteries = this.database.collection<ChampionMasteryRow>(mongoCollections.championMasteries);
			const snapshots = this.database.collection<MasterySnapshotDocument>(mongoCollections.masterySnapshots);
			const previous = await profiles.findOne({ guildId, userId }, { session });
			if (previous && previous.puuidSnapshot !== data.puuid) {
				await snapshots.deleteMany({ guildId, userId }, { session });
				await masteries.deleteMany({ guildId, userId }, { session });
			}
			const profileFields = {
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
				statsSyncStatus: "SUCCEEDED" as const,
				statsSyncFailureCount: 0,
				lastStatsSyncErrorCode: null,
				updatedAt: now,
			};
			await profiles.updateOne({ guildId, userId }, { $set: profileFields, $setOnInsert: { guildId, userId, createdAt: now } }, { upsert: true, session });
			const existing = await masteries.find({ guildId, userId }, { projection: { championId: 1, championPoints: 1 }, session }).toArray();
			const oldPoints = new Map(existing.map((row) => [row.championId, row.championPoints]));
			if (data.masteries.length)
				await masteries.bulkWrite(
					data.masteries.map((mastery) => ({
						updateOne: {
							filter: { guildId, userId, championId: mastery.championId },
							update: { $set: { ...mastery, updatedAt: now }, $setOnInsert: { guildId, userId } },
							upsert: true,
						},
					})),
					{ session }
				);
			const changed = data.masteries.flatMap((mastery) => {
				const old = oldPoints.get(mastery.championId);
				if (old == null || old === mastery.championPoints) return [];
				return [
					{
						id: crypto.randomUUID(),
						guildId,
						userId,
						championId: mastery.championId,
						championPoints: mastery.championPoints,
						delta: mastery.championPoints - old,
						capturedAt: now,
						capturedAtDate: new Date(now),
					},
				];
			});
			if (changed.length) await snapshots.insertMany(changed, { session });
		});
		return (await this.profile(guildId, userId))!;
	}

	async fail(guildId: string, userId: string, code: string, nextSyncAt: number, now = Date.now()): Promise<void> {
		const collection = this.database.collection<LeagueProfile>(mongoCollections.leagueProfiles);
		const old = await this.profile(guildId, userId);
		await collection.updateOne(
			{ guildId, userId },
			{
				$set: {
					puuidSnapshot: old?.puuidSnapshot ?? "pending",
					nextStatsSyncAt: nextSyncAt,
					statsSyncStatus: "FAILED_RETRYABLE",
					statsSyncFailureCount: (old?.statsSyncFailureCount ?? 0) + 1,
					lastStatsSyncErrorCode: code,
					updatedAt: now,
				},
				$setOnInsert: { guildId, userId, totalMasteryScore: 0, createdAt: old?.createdAt ?? now },
			},
			{ upsert: true }
		);
	}
}

function rankFields(prefix: "solo" | "flex", entry: RankedEntry | undefined) {
	return {
		[`${prefix}Tier`]: entry?.tier ?? null,
		[`${prefix}Division`]: entry?.rank ?? null,
		[`${prefix}LeaguePoints`]: entry?.leaguePoints ?? null,
		[`${prefix}Wins`]: entry?.wins ?? null,
		[`${prefix}Losses`]: entry?.losses ?? null,
	} as Record<string, string | number | null>;
}
