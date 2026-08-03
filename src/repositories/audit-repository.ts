import { and, eq, lt } from "drizzle-orm";
import type { DatabaseContext } from "../database/client.js";
import { auditEvents } from "../database/schema/index.js";

export class AuditRepository {
	constructor(private readonly database: DatabaseContext) {}

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
		this.database.db
			.insert(auditEvents)
			.values({
				id: crypto.randomUUID(),
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
	}

	scrubUser(guildId: string, userId: string): void {
		this.database.db
			.update(auditEvents)
			.set({ metadata: "{}" })
			.where(and(eq(auditEvents.guildId, guildId), eq(auditEvents.targetUserId, userId)))
			.run();
	}

	deleteOlderThan(cutoff: number): number {
		return this.database.db.delete(auditEvents).where(lt(auditEvents.createdAt, cutoff)).run().changes;
	}
}
