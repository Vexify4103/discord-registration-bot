import { and, asc, desc, eq, lte } from "drizzle-orm";
import type { DatabaseContext } from "../database/client.js";
import { pendingOperations, registrations, type PendingOperation } from "../database/schema/index.js";
import type { DiscordOperationType } from "../types/domain.js";

export interface EnqueueOperation {
	guildId: string;
	userId: string;
	operationType: DiscordOperationType;
	payload: Record<string, unknown>;
	priority: number;
	stateVersion: number;
	now?: number;
}

export class PendingOperationRepository {
	constructor(private readonly database: DatabaseContext) {}

	enqueue(input: EnqueueOperation): void {
		const now = input.now ?? Date.now();
		const deduplicationKey = `${input.guildId}:${input.userId}:${input.operationType}`;
		this.database.db
			.insert(pendingOperations)
			.values({
				id: crypto.randomUUID(),
				guildId: input.guildId,
				userId: input.userId,
				operationType: input.operationType,
				payload: JSON.stringify(input.payload),
				priority: input.priority,
				stateVersion: input.stateVersion,
				deduplicationKey,
				nextAttemptAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: pendingOperations.deduplicationKey,
				set: {
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
			})
			.run();
	}

	due(now = Date.now(), limit = 20): PendingOperation[] {
		return this.database.db
			.select()
			.from(pendingOperations)
			.where(and(eq(pendingOperations.terminal, false), lte(pendingOperations.nextAttemptAt, now)))
			.orderBy(desc(pendingOperations.priority), asc(pendingOperations.createdAt))
			.limit(limit)
			.all();
	}

	isCurrent(operation: PendingOperation): boolean {
		const row = this.database.db
			.select({ version: registrations.stateVersion })
			.from(registrations)
			.where(and(eq(registrations.guildId, operation.guildId), eq(registrations.userId, operation.userId)))
			.get();
		return row?.version === operation.stateVersion;
	}

	complete(id: string): void {
		this.database.db.delete(pendingOperations).where(eq(pendingOperations.id, id)).run();
	}

	fail(id: string, errorCode: string, retryable: boolean, maxRetries: number, now = Date.now()): void {
		const row = this.database.db.select().from(pendingOperations).where(eq(pendingOperations.id, id)).get();
		if (!row) return;
		const attempts = row.attemptCount + 1;
		const terminal = !retryable || attempts >= maxRetries;
		const delay = Math.min(60 * 60_000, 2 ** attempts * 1_000 + Math.floor(Math.random() * 1_000));
		this.database.db
			.update(pendingOperations)
			.set({
				attemptCount: attempts,
				lastErrorCode: errorCode,
				terminal,
				nextAttemptAt: now + delay,
				updatedAt: now,
				leaseOwner: null,
				leaseExpiresAt: null,
			})
			.where(eq(pendingOperations.id, id))
			.run();
	}
}
