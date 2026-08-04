import { and, asc, eq, lte } from "drizzle-orm";
import type { DatabaseContext } from "../database/client.js";
import { auditEvents, discordAuditOutbox, type AuditEvent, type DiscordAuditOutboxRow } from "../database/schema/index.js";

export interface DueDiscordAudit {
	event: AuditEvent;
	outbox: DiscordAuditOutboxRow;
}

export class DiscordAuditOutboxRepository {
	constructor(private readonly database: DatabaseContext) {}

	due(now = Date.now(), limit = 5): DueDiscordAudit[] {
		return this.database.db
			.select({ event: auditEvents, outbox: discordAuditOutbox })
			.from(discordAuditOutbox)
			.innerJoin(auditEvents, eq(discordAuditOutbox.eventId, auditEvents.id))
			.where(and(eq(discordAuditOutbox.terminal, false), lte(discordAuditOutbox.nextAttemptAt, now)))
			.orderBy(asc(discordAuditOutbox.createdAt))
			.limit(limit)
			.all();
	}

	complete(eventId: string): void {
		this.database.db.delete(discordAuditOutbox).where(eq(discordAuditOutbox.eventId, eventId)).run();
	}

	fail(eventId: string, errorCode: string, retryable: boolean, now = Date.now()): void {
		const current = this.database.db.select().from(discordAuditOutbox).where(eq(discordAuditOutbox.eventId, eventId)).get();
		if (!current) return;
		const attempts = current.attemptCount + 1;
		const terminal = !retryable;
		const backoff = Math.min(15 * 60_000, 5_000 * 2 ** Math.min(attempts - 1, 8));
		this.database.db
			.update(discordAuditOutbox)
			.set({
				attemptCount: attempts,
				lastErrorCode: errorCode,
				terminal,
				nextAttemptAt: terminal ? now : now + backoff,
				updatedAt: now,
			})
			.where(eq(discordAuditOutbox.eventId, eventId))
			.run();
	}
}
