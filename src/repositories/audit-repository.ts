import { and, eq, lt } from "drizzle-orm";
import type { DatabaseContext } from "../database/client.js";
import { auditEvents, discordAuditOutbox } from "../database/schema/index.js";
import { enqueueDiscordAudit } from "./discord-audit-outbox.js";

export class AuditRepository {
	constructor(
		private readonly database: DatabaseContext,
		private readonly discordAuditEnabled = false
	) {}

	create(input: {
		guildId: string;
		targetUserId?: string | null;
		actorUserId?: string | null;
		action: string;
		result: string;
		metadata?: Record<string, unknown>;
		correlationId?: string;
		now?: number;
	}): void {
		const now = input.now ?? Date.now();
		this.database.sqlite.transaction(() => {
			const id = crypto.randomUUID();
			this.database.db
				.insert(auditEvents)
				.values({
					id,
					guildId: input.guildId,
					targetUserId: input.targetUserId ?? null,
					actorUserId: input.actorUserId ?? null,
					action: input.action,
					result: input.result,
					metadata: JSON.stringify(input.metadata ?? {}),
					correlationId: input.correlationId ?? crypto.randomUUID(),
					createdAt: now,
				})
				.run();
			enqueueDiscordAudit(this.database, this.discordAuditEnabled, id, input.guildId, input.action, now);
		})();
	}

	scrubUser(guildId: string, userId: string): void {
		this.database.db
			.update(auditEvents)
			.set({ metadata: "{}" })
			.where(and(eq(auditEvents.guildId, guildId), eq(auditEvents.targetUserId, userId)))
			.run();
	}

	deleteOlderThan(cutoff: number): number {
		return this.database.sqlite.transaction(() => {
			this.database.db.delete(discordAuditOutbox).where(lt(discordAuditOutbox.createdAt, cutoff)).run();
			return this.database.db.delete(auditEvents).where(lt(auditEvents.createdAt, cutoff)).run().changes;
		})();
	}
}
