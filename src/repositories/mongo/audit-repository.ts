import type { ClientSession } from "mongodb";
import { mongoCollections, type MongoDatabaseContext } from "../../database/mongo-client.js";
import type { AuditEvent, DiscordAuditOutboxRow } from "../../database/schema/index.js";

const INTERNAL_ONLY_ACTIONS = new Set(["MIGRATION_CLASSIFICATION", "MIGRATION_REVIEW_CLASSIFICATION"]);

export class AuditRepository {
	constructor(
		private readonly database: MongoDatabaseContext,
		private readonly discordAuditEnabled = false
	) {}

	async create(input: {
		guildId: string;
		targetUserId?: string | null;
		actorUserId?: string | null;
		action: string;
		result: string;
		metadata?: Record<string, unknown>;
		correlationId?: string;
		now?: number;
	}): Promise<void> {
		const now = input.now ?? Date.now();
		await this.database.transaction(async (session) => {
			const id = crypto.randomUUID();
			await this.database.collection<AuditEvent>(mongoCollections.auditEvents).insertOne(
				{
					id,
					guildId: input.guildId,
					targetUserId: input.targetUserId ?? null,
					actorUserId: input.actorUserId ?? null,
					action: input.action,
					result: input.result,
					metadata: JSON.stringify(input.metadata ?? {}),
					correlationId: input.correlationId ?? crypto.randomUUID(),
					schemaVersion: 1,
					createdAt: now,
					expiresAt: new Date(now + 180 * 86_400_000),
				} as AuditEvent & { expiresAt: Date },
				{ session }
			);
			if (this.discordAuditEnabled && !INTERNAL_ONLY_ACTIONS.has(input.action)) await this.enqueueOutbox(id, input.guildId, now, session);
		});
	}

	async scrubUser(guildId: string, userId: string): Promise<void> {
		await this.database.collection<AuditEvent>(mongoCollections.auditEvents).updateMany({ guildId, targetUserId: userId }, { $set: { metadata: "{}" } });
	}

	async deleteOlderThan(cutoff: number): Promise<number> {
		return this.database.transaction(async (session) => {
			const events = this.database.collection<AuditEvent>(mongoCollections.auditEvents);
			const ids = await events.find({ createdAt: { $lt: cutoff } }, { projection: { id: 1 }, session }).map((row) => row.id).toArray();
			if (ids.length) await this.database.collection<DiscordAuditOutboxRow>(mongoCollections.discordAuditOutbox).deleteMany({ eventId: { $in: ids } }, { session });
			return (await events.deleteMany({ createdAt: { $lt: cutoff } }, { session })).deletedCount;
		});
	}

	private async enqueueOutbox(eventId: string, guildId: string, now: number, session: ClientSession): Promise<void> {
		await this.database.collection<DiscordAuditOutboxRow>(mongoCollections.discordAuditOutbox).insertOne(
			{
				eventId,
				guildId,
				attemptCount: 0,
				nextAttemptAt: now,
				lastErrorCode: null,
				terminal: false,
				createdAt: now,
				updatedAt: now,
			},
			{ session }
		);
	}
}
