import type { DatabaseContext } from "../database/client.js";
import { discordAuditOutbox } from "../database/schema/index.js";

const INTERNAL_ONLY_ACTIONS = new Set(["MIGRATION_CLASSIFICATION", "MIGRATION_REVIEW_CLASSIFICATION"]);

export function enqueueDiscordAudit(database: DatabaseContext, enabled: boolean, eventId: string, guildId: string, action: string, now: number): void {
	if (!enabled || INTERNAL_ONLY_ACTIONS.has(action)) return;
	database.db.insert(discordAuditOutbox).values({ eventId, guildId, nextAttemptAt: now, createdAt: now, updatedAt: now }).run();
}
