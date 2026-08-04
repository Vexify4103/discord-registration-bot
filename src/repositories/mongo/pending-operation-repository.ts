import { mongoCollections, type MongoDatabaseContext } from "../../database/mongo-client.js";
import type { PendingOperation, Registration } from "../../database/schema/index.js";
import type { EnqueueOperation } from "../pending-operation-repository.js";
import { withoutMongoId, withoutMongoIds } from "./helpers.js";

export class PendingOperationRepository {
	constructor(private readonly database: MongoDatabaseContext) {}

	async enqueue(input: EnqueueOperation): Promise<void> {
		const now = input.now ?? Date.now();
		const deduplicationKey = `${input.guildId}:${input.userId}:${input.operationType}`;
		await this.database.collection<PendingOperation>(mongoCollections.pendingOperations).updateOne(
			{ deduplicationKey },
			{
				$set: {
					guildId: input.guildId,
					userId: input.userId,
					operationType: input.operationType,
					payload: JSON.stringify(input.payload),
					priority: input.priority,
					stateVersion: input.stateVersion,
					nextAttemptAt: now,
					attemptCount: 0,
					terminal: false,
					lastErrorCode: null,
					leaseOwner: null,
					leaseExpiresAt: null,
					updatedAt: now,
				},
				$setOnInsert: { id: crypto.randomUUID(), deduplicationKey, createdAt: now },
			},
			{ upsert: true }
		);
	}

	async due(now = Date.now(), limit = 20): Promise<PendingOperation[]> {
		return withoutMongoIds(
			await this.database
				.collection<PendingOperation>(mongoCollections.pendingOperations)
				.find({ terminal: false, nextAttemptAt: { $lte: now } })
				.sort({ priority: -1, createdAt: 1 })
				.limit(limit)
				.toArray()
		);
	}

	async isCurrent(operation: PendingOperation): Promise<boolean> {
		const row = withoutMongoId(
			await this.database.collection<Registration>(mongoCollections.registrations).findOne(
				{ guildId: operation.guildId, userId: operation.userId },
				{ projection: { stateVersion: 1 } }
			)
		);
		return row?.stateVersion === operation.stateVersion;
	}

	async complete(id: string): Promise<void> {
		await this.database.collection<PendingOperation>(mongoCollections.pendingOperations).deleteOne({ id });
	}

	async fail(id: string, errorCode: string, retryable: boolean, maxRetries: number, now = Date.now()): Promise<void> {
		const collection = this.database.collection<PendingOperation>(mongoCollections.pendingOperations);
		const row = await collection.findOne({ id });
		if (!row) return;
		const attempts = row.attemptCount + 1;
		const terminal = !retryable || attempts >= maxRetries;
		const delay = Math.min(60 * 60_000, 2 ** attempts * 1_000 + Math.floor(Math.random() * 1_000));
		await collection.updateOne(
			{ id },
			{
				$set: {
					attemptCount: attempts,
					lastErrorCode: errorCode,
					terminal,
					nextAttemptAt: now + delay,
					updatedAt: now,
					leaseOwner: null,
					leaseExpiresAt: null,
				},
			}
		);
	}
}
