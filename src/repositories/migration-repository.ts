import { and, asc, count, eq, lte, or } from "drizzle-orm";
import type { DatabaseContext } from "../database/client.js";
import { migrationItems, migrationJobs, type MigrationItem, type MigrationJob } from "../database/schema/index.js";
import type { LegacyParseResult } from "../parsers/legacy-nickname-parser.js";

export interface PreviewItem {
	guildId: string;
	userId: string;
	username: string;
	nickname: string | null;
	parsed: LegacyParseResult;
	manageable: boolean;
	fingerprint: string;
	estimatedOperations: string[];
}

export class MigrationRepository {
	constructor(private readonly database: DatabaseContext) {}
	createPreview(guildId: string, actorId: string, configSnapshot: string, fingerprint: string, items: PreviewItem[], now = Date.now()): MigrationJob {
		const id = crypto.randomUUID();
		this.database.sqlite.transaction(() => {
			this.database.db
				.insert(migrationJobs)
				.values({
					id,
					guildId,
					status: "PREVIEWED",
					mode: "preview",
					startedBy: actorId,
					startedAt: now,
					totalMembers: items.length,
					configurationSnapshot: configSnapshot,
					previewFingerprint: fingerprint,
					updatedAt: now,
				})
				.run();
			if (items.length)
				this.database.db
					.insert(migrationItems)
					.values(
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
							estimatedOperations: JSON.stringify(item.estimatedOperations),
							metadata: "{}",
							createdAt: now,
							updatedAt: now,
						}))
					)
					.run();
		})();
		return this.getJob(id)!;
	}
	getJob(id: string): MigrationJob | undefined {
		return this.database.db.select().from(migrationJobs).where(eq(migrationJobs.id, id)).get();
	}
	latest(guildId: string): MigrationJob | undefined {
		return this.database.db.select().from(migrationJobs).where(eq(migrationJobs.guildId, guildId)).orderBy(asc(migrationJobs.startedAt)).all().at(-1);
	}
	items(jobId: string): MigrationItem[] {
		return this.database.db.select().from(migrationItems).where(eq(migrationItems.jobId, jobId)).orderBy(asc(migrationItems.sequence)).all();
	}
	manualReviewCount(jobId: string): number {
		return (
			this.database.db
				.select({ value: count() })
				.from(migrationItems)
				.where(and(eq(migrationItems.jobId, jobId), eq(migrationItems.state, "MANUAL_REVIEW")))
				.get()?.value ?? 0
		);
	}
	next(jobId: string): MigrationItem | undefined {
		return this.database.db
			.select()
			.from(migrationItems)
			.where(
				and(
					eq(migrationItems.jobId, jobId),
					or(eq(migrationItems.state, "PREVIEWED"), and(eq(migrationItems.state, "PENDING_RETRY"), lte(migrationItems.nextAttemptAt, Date.now())))
				)
			)
			.orderBy(asc(migrationItems.sequence))
			.get();
	}
	setConfirmation(id: string, hash: string, expiresAt: number): void {
		this.database.db
			.update(migrationJobs)
			.set({
				confirmationHash: hash,
				confirmationExpiresAt: expiresAt,
				updatedAt: Date.now(),
			})
			.where(eq(migrationJobs.id, id))
			.run();
	}
	start(id: string): void {
		this.database.db
			.update(migrationJobs)
			.set({
				status: "RUNNING",
				mode: "apply",
				confirmationHash: null,
				confirmationExpiresAt: null,
				updatedAt: Date.now(),
			})
			.where(eq(migrationJobs.id, id))
			.run();
	}
	pause(id: string, reason: string): void {
		this.database.db.update(migrationJobs).set({ status: "PAUSED", pauseReason: reason, updatedAt: Date.now() }).where(eq(migrationJobs.id, id)).run();
	}
	cancel(id: string): void {
		this.database.db
			.update(migrationJobs)
			.set({
				status: "CANCELLED",
				confirmationHash: null,
				confirmationExpiresAt: null,
				updatedAt: Date.now(),
			})
			.where(eq(migrationJobs.id, id))
			.run();
	}
	resume(id: string): void {
		this.database.db.update(migrationJobs).set({ status: "RUNNING", pauseReason: null, updatedAt: Date.now() }).where(eq(migrationJobs.id, id)).run();
	}
	completeItem(item: MigrationItem, outcome: "VERIFIED" | "UNREGISTERED" | "PENDING" | "FAILED" | "SKIPPED" | "MANUAL_REVIEW", error?: string): void {
		const state = outcome === "PENDING" ? "PENDING_RETRY" : outcome;
		this.database.sqlite.transaction(() => {
			this.database.db
				.update(migrationItems)
				.set({
					state,
					attemptCount: item.attemptCount + 1,
					nextAttemptAt: outcome === "PENDING" ? Date.now() + 60_000 : null,
					lastErrorCode: error ?? null,
					updatedAt: Date.now(),
				})
				.where(eq(migrationItems.id, item.id))
				.run();
			const job = this.getJob(item.jobId)!;
			const updates: Partial<typeof migrationJobs.$inferInsert> = {
				processedMembers: job.processedMembers + (outcome === "PENDING" ? 0 : 1),
				lastProcessedUserId: item.userId,
				cursorSequence: item.sequence,
				updatedAt: Date.now(),
			};
			if (outcome === "VERIFIED") updates.verifiedMembers = job.verifiedMembers + 1;
			if (outcome === "UNREGISTERED") updates.unregisteredMembers = job.unregisteredMembers + 1;
			if ((outcome === "PENDING" || outcome === "MANUAL_REVIEW") && item.state !== "PENDING_RETRY") updates.pendingMembers = job.pendingMembers + 1;
			if (outcome !== "PENDING" && outcome !== "MANUAL_REVIEW" && item.state === "PENDING_RETRY") updates.pendingMembers = Math.max(0, job.pendingMembers - 1);
			if (outcome === "FAILED") updates.failedMembers = job.failedMembers + 1;
			this.database.db.update(migrationJobs).set(updates).where(eq(migrationJobs.id, item.jobId)).run();
		})();
	}
	finishIfDone(id: string): boolean {
		const remaining = this.database.db
			.select({ id: migrationItems.id })
			.from(migrationItems)
			.where(and(eq(migrationItems.jobId, id), or(eq(migrationItems.state, "PREVIEWED"), eq(migrationItems.state, "PENDING_RETRY"))))
			.get();
		if (remaining) return false;
		this.database.db
			.update(migrationJobs)
			.set({
				status: "COMPLETED",
				completedAt: Date.now(),
				updatedAt: Date.now(),
			})
			.where(eq(migrationJobs.id, id))
			.run();
		return true;
	}
}
