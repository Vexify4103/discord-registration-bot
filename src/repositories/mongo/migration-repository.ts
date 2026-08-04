import { mongoCollections, type MongoDatabaseContext } from "../../database/mongo-client.js";
import type { MigrationItem, MigrationJob } from "../../database/schema/index.js";
import type { PreviewItem } from "../migration-repository.js";
import { withoutMongoId, withoutMongoIds } from "./helpers.js";

export class MigrationRepository {
	constructor(private readonly database: MongoDatabaseContext) {}

	async createPreview(guildId: string, actorId: string, configSnapshot: string, fingerprint: string, items: PreviewItem[], now = Date.now()): Promise<MigrationJob> {
		const id = crypto.randomUUID();
		await this.database.transaction(async (session) => {
			await this.database.collection<MigrationJob>(mongoCollections.migrationJobs).insertOne(
				{
					id,
					guildId,
					status: "PREVIEWED",
					mode: "preview",
					startedBy: actorId,
					startedAt: now,
					completedAt: null,
					lastProcessedUserId: null,
					cursorSequence: 0,
					totalMembers: items.length,
					processedMembers: 0,
					verifiedMembers: 0,
					unregisteredMembers: 0,
					pendingMembers: 0,
					failedMembers: 0,
					configurationSnapshot: configSnapshot,
					previewFingerprint: fingerprint,
					confirmationHash: null,
					confirmationExpiresAt: null,
					pauseReason: null,
					leaseOwner: null,
					leaseExpiresAt: null,
					updatedAt: now,
				},
				{ session }
			);
			if (items.length)
				await this.database.collection<MigrationItem>(mongoCollections.migrationItems).insertMany(
					items.map((item, sequence) => ({
						id: crypto.randomUUID(),
						jobId: id,
						sequence,
						guildId,
						userId: item.userId,
						usernameSnapshot: item.username,
						originalNickname: item.nickname,
						category: item.parsed.category,
						parsedDisplayName: item.parsed.displayName,
						parsedGameName: item.parsed.gameName,
						parsedTagLine: item.parsed.tagLine,
						snapshotFingerprint: item.fingerprint,
						manageable: item.manageable,
						state: "PREVIEWED",
						attemptCount: 0,
						nextAttemptAt: null,
						lastErrorCode: null,
						estimatedOperations: JSON.stringify(item.estimatedOperations),
						metadata: "{}",
						createdAt: now,
						updatedAt: now,
					})),
					{ session }
				);
		});
		return (await this.getJob(id))!;
	}

	async getJob(id: string): Promise<MigrationJob | undefined> {
		return withoutMongoId(await this.database.collection<MigrationJob>(mongoCollections.migrationJobs).findOne({ id }));
	}

	async latest(guildId: string): Promise<MigrationJob | undefined> {
		return withoutMongoId(await this.database.collection<MigrationJob>(mongoCollections.migrationJobs).findOne({ guildId }, { sort: { startedAt: -1 } }));
	}

	async latestReviewable(guildId: string): Promise<MigrationJob | undefined> {
		const jobs = withoutMongoIds(await this.database.collection<MigrationJob>(mongoCollections.migrationJobs).find({ guildId }).sort({ startedAt: -1 }).toArray());
		for (const job of jobs) if ((await this.reviewCandidates(job.id)).length) return job;
		return undefined;
	}

	async active(guildId: string): Promise<MigrationJob | undefined> {
		return withoutMongoId(
			await this.database.collection<MigrationJob>(mongoCollections.migrationJobs).findOne({ guildId, status: { $in: ["RUNNING", "PAUSED"] } }, { sort: { startedAt: -1 } })
		);
	}

	async running(guildId: string): Promise<MigrationJob | undefined> {
		return withoutMongoId(await this.database.collection<MigrationJob>(mongoCollections.migrationJobs).findOne({ guildId, status: "RUNNING" }, { sort: { startedAt: -1 } }));
	}

	async items(jobId: string): Promise<MigrationItem[]> {
		return withoutMongoIds(await this.database.collection<MigrationItem>(mongoCollections.migrationItems).find({ jobId }).sort({ sequence: 1 }).toArray());
	}

	async manualReviewCount(jobId: string): Promise<number> {
		return this.database.collection<MigrationItem>(mongoCollections.migrationItems).countDocuments({ jobId, state: "MANUAL_REVIEW" });
	}

	async manualReviewItems(jobId: string): Promise<MigrationItem[]> {
		return withoutMongoIds(
			await this.database.collection<MigrationItem>(mongoCollections.migrationItems).find({ jobId, state: "MANUAL_REVIEW" }).sort({ sequence: 1 }).toArray()
		);
	}

	async reviewCandidates(jobId: string): Promise<MigrationItem[]> {
		return withoutMongoIds(
			await this.database
				.collection<MigrationItem>(mongoCollections.migrationItems)
				.find({ jobId, state: { $in: ["MANUAL_REVIEW", "FAILED"] } })
				.sort({ sequence: 1 })
				.toArray()
		);
	}

	async markReviewCandidatesRequeued(jobId: string, userIds: string[], now = Date.now()): Promise<void> {
		if (!userIds.length) return;
		await this.database
			.collection<MigrationItem>(mongoCollections.migrationItems)
			.updateMany({ jobId, userId: { $in: userIds }, state: { $in: ["MANUAL_REVIEW", "FAILED"] } }, { $set: { state: "REQUEUED_FOR_REVIEW", updatedAt: now } });
	}

	async pendingRetryCount(jobId: string): Promise<number> {
		return this.database.collection<MigrationItem>(mongoCollections.migrationItems).countDocuments({ jobId, state: "PENDING_RETRY" });
	}

	async next(jobId: string): Promise<MigrationItem | undefined> {
		return withoutMongoId(
			await this.database.collection<MigrationItem>(mongoCollections.migrationItems).findOne(
				{ jobId, $or: [{ state: "PREVIEWED" }, { state: "PENDING_RETRY", nextAttemptAt: { $lte: Date.now() } }] },
				{ sort: { sequence: 1 } }
			)
		);
	}

	async setConfirmation(id: string, hash: string, expiresAt: number): Promise<void> {
		await this.database.collection<MigrationJob>(mongoCollections.migrationJobs).updateOne({ id }, { $set: { confirmationHash: hash, confirmationExpiresAt: expiresAt, updatedAt: Date.now() } });
	}

	async start(id: string): Promise<void> {
		await this.startJob(id, Date.now());
	}

	async startReview(id: string, sourceJobId: string, userIds: string[]): Promise<void> {
		const now = Date.now();
		await this.database.transaction(async (session) => {
			await this.startJob(id, now, session);
			if (userIds.length)
				await this.database.collection<MigrationItem>(mongoCollections.migrationItems).updateMany(
					{ jobId: sourceJobId, userId: { $in: userIds }, state: { $in: ["MANUAL_REVIEW", "FAILED"] } },
					{ $set: { state: "REQUEUED_FOR_REVIEW", updatedAt: now } },
					{ session }
				);
		});
	}

	private async startJob(id: string, now: number, session?: import("mongodb").ClientSession): Promise<void> {
		await this.database.collection<MigrationJob>(mongoCollections.migrationJobs).updateOne(
			{ id },
			{ $set: { status: "RUNNING", mode: "apply", confirmationHash: null, confirmationExpiresAt: null, updatedAt: now } },
			{ ...(session ? { session } : {}) }
		);
	}

	async pause(id: string, reason: string): Promise<void> {
		await this.database.collection<MigrationJob>(mongoCollections.migrationJobs).updateOne({ id }, { $set: { status: "PAUSED", pauseReason: reason, updatedAt: Date.now() } });
	}

	async cancel(id: string): Promise<void> {
		await this.database
			.collection<MigrationJob>(mongoCollections.migrationJobs)
			.updateOne({ id }, { $set: { status: "CANCELLED", confirmationHash: null, confirmationExpiresAt: null, updatedAt: Date.now() } });
	}

	async resume(id: string): Promise<void> {
		await this.database.collection<MigrationJob>(mongoCollections.migrationJobs).updateOne({ id }, { $set: { status: "RUNNING", pauseReason: null, updatedAt: Date.now() } });
	}

	async completeItem(
		item: MigrationItem,
		outcome: "VERIFIED" | "VERIFIED_NO_RIOT" | "UNREGISTERED" | "PENDING" | "FAILED" | "SKIPPED" | "MANUAL_REVIEW",
		error?: string,
		metadata?: Record<string, unknown>
	): Promise<void> {
		const state = outcome === "PENDING" ? "PENDING_RETRY" : outcome;
		await this.database.transaction(async (session) => {
			await this.database.collection<MigrationItem>(mongoCollections.migrationItems).updateOne(
				{ id: item.id },
				{
					$set: {
						state,
						attemptCount: item.attemptCount + 1,
						nextAttemptAt: outcome === "PENDING" ? Date.now() + 60_000 : null,
						lastErrorCode: error ?? null,
						...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
						updatedAt: Date.now(),
					},
				},
				{ session }
			);
			const increments: Record<string, number> = {};
			if (outcome !== "PENDING") increments.processedMembers = 1;
			if (outcome === "VERIFIED" || outcome === "VERIFIED_NO_RIOT") increments.verifiedMembers = 1;
			if (outcome === "UNREGISTERED") increments.unregisteredMembers = 1;
			if ((outcome === "PENDING" || outcome === "MANUAL_REVIEW") && item.state !== "PENDING_RETRY") increments.pendingMembers = 1;
			if (outcome !== "PENDING" && outcome !== "MANUAL_REVIEW" && item.state === "PENDING_RETRY") increments.pendingMembers = -1;
			if (outcome === "FAILED") increments.failedMembers = 1;
			await this.database.collection<MigrationJob>(mongoCollections.migrationJobs).updateOne(
				{ id: item.jobId },
				{ $inc: increments, $set: { lastProcessedUserId: item.userId, cursorSequence: item.sequence, updatedAt: Date.now() } },
				{ session }
			);
		});
	}

	async finishIfDone(id: string): Promise<boolean> {
		const remaining = await this.database.collection<MigrationItem>(mongoCollections.migrationItems).findOne({ jobId: id, state: { $in: ["PREVIEWED", "PENDING_RETRY"] } });
		if (remaining) return false;
		await this.database.collection<MigrationJob>(mongoCollections.migrationJobs).updateOne(
			{ id },
			{ $set: { status: "COMPLETED", completedAt: Date.now(), updatedAt: Date.now() } }
		);
		return true;
	}
}
