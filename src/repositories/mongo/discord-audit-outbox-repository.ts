import { mongoCollections, type MongoDatabaseContext } from "../../database/mongo-client.js";
import type { AuditEvent, DiscordAuditOutboxRow } from "../../database/schema/index.js";
import type { DueDiscordAudit } from "../discord-audit-outbox-repository.js";
import { withoutMongoIds } from "./helpers.js";

export class DiscordAuditOutboxRepository {
	constructor(private readonly database: MongoDatabaseContext) {}

	async due(now = Date.now(), limit = 5): Promise<DueDiscordAudit[]> {
		const outbox = withoutMongoIds(
			await this.database
				.collection<DiscordAuditOutboxRow>(mongoCollections.discordAuditOutbox)
				.find({ terminal: false, nextAttemptAt: { $lte: now } })
				.sort({ createdAt: 1 })
				.limit(limit)
				.toArray()
		);
		if (!outbox.length) return [];
		const events = withoutMongoIds(
			await this.database
				.collection<AuditEvent>(mongoCollections.auditEvents)
				.find({ id: { $in: outbox.map((row) => row.eventId) } })
				.toArray()
		);
		const byId = new Map(events.map((event) => [event.id, event]));
		const orphaned = outbox.filter((row) => !byId.has(row.eventId)).map((row) => row.eventId);
		if (orphaned.length)
			await this.database.collection<DiscordAuditOutboxRow>(mongoCollections.discordAuditOutbox).deleteMany({ eventId: { $in: orphaned } });
		return outbox.flatMap((row) => (byId.has(row.eventId) ? [{ event: byId.get(row.eventId)!, outbox: row }] : []));
	}

	async complete(eventId: string): Promise<void> {
		await this.database.collection<DiscordAuditOutboxRow>(mongoCollections.discordAuditOutbox).deleteOne({ eventId });
	}

	async fail(eventId: string, errorCode: string, retryable: boolean, now = Date.now()): Promise<void> {
		const collection = this.database.collection<DiscordAuditOutboxRow>(mongoCollections.discordAuditOutbox);
		const current = await collection.findOne({ eventId });
		if (!current) return;
		const attempts = current.attemptCount + 1;
		const terminal = !retryable;
		const backoff = Math.min(15 * 60_000, 5_000 * 2 ** Math.min(attempts - 1, 8));
		await collection.updateOne(
			{ eventId },
			{ $set: { attemptCount: attempts, lastErrorCode: errorCode, terminal, nextAttemptAt: terminal ? now : now + backoff, updatedAt: now } }
		);
	}
}
