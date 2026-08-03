import { and, eq, gt, isNotNull, lt, lte, ne } from "drizzle-orm";
import type { DatabaseContext } from "../database/client.js";
import { auditEvents, pendingOperations, registrationAttempts, registrations, retainedRegistrationData, type Registration } from "../database/schema/index.js";
import type { DiscordOperationType, NameVisibility, RegistrationIdentity } from "../types/domain.js";
import { operationPriorities } from "../types/domain.js";
import { buildOpggUrl } from "../parsers/opgg-parser.js";

export interface SaveRegistrationInput {
	guildId: string;
	userId: string;
	actorUserId: string;
	discordUsername: string;
	displayName: string | null;
	nameVisibility: NameVisibility;
	identity: RegistrationIdentity;
	overrideDuplicate?: boolean;
	overrideAuthorized?: boolean;
	priority?: number;
	now?: number;
}

export interface SaveVerifiedWithoutRiotInput {
	guildId: string;
	userId: string;
	actorUserId: string;
	discordUsername: string;
	displayName: string;
	migrationJobId?: string;
	originalNickname?: string | null;
	reason: "LEGACY_NO_RIOT" | "RIOT_NOT_FOUND" | "ADMIN_NICKNAME" | "ADMIN_RIOT_NOT_FOUND";
	priority?: number;
	now?: number;
}

export class DuplicatePuuidError extends Error {}

export class RegistrationRepository {
	constructor(
		private readonly database: DatabaseContext,
		private readonly retentionDays: number
	) {}

	get(guildId: string, userId: string): Registration | undefined {
		return this.database.db
			.select()
			.from(registrations)
			.where(and(eq(registrations.guildId, guildId), eq(registrations.userId, userId)))
			.get();
	}

	upsertJoined(guildId: string, userId: string, username: string, joinedAt: number): Registration {
		const existing = this.get(guildId, userId);
		const now = Date.now();
		if (existing?.isPresent) return existing;
		if ((existing?.status === "REGISTERED" || existing?.status === "VERIFIED_NO_RIOT") && (!existing.retentionExpiresAt || existing.retentionExpiresAt > now)) {
			this.database.db
				.update(registrations)
				.set({
					isPresent: true,
					joinedAt,
					leftAt: null,
					retentionExpiresAt: null,
					discordUsernameSnapshot: username,
					stateVersion: existing.stateVersion + 1,
					nicknameSyncStatus: "PENDING",
					roleSyncStatus: "PENDING",
					updatedAt: now,
				})
				.where(and(eq(registrations.guildId, guildId), eq(registrations.userId, userId)))
				.run();
		} else {
			this.database.db
				.insert(registrations)
				.values({
					guildId,
					userId,
					discordUsernameSnapshot: username,
					status: "UNREGISTERED",
					isPresent: true,
					joinedAt,
					unregisteredSince: joinedAt,
					stateVersion: (existing?.stateVersion ?? 0) + 1,
					nicknameSyncStatus: "PENDING",
					roleSyncStatus: "PENDING",
					createdAt: existing?.createdAt ?? now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [registrations.guildId, registrations.userId],
					set: {
						discordUsernameSnapshot: username,
						status: "UNREGISTERED",
						isPresent: true,
						joinedAt,
						leftAt: null,
						retentionExpiresAt: null,
						unregisteredSince: joinedAt,
						displayName: null,
						nameVisibility: null,
						puuid: null,
						gameName: null,
						tagLine: null,
						riotId: null,
						platformRegion: null,
						accountRoutingGroup: null,
						opggUrl: null,
						registeredAt: null,
						stateVersion: (existing?.stateVersion ?? 0) + 1,
						nicknameSyncStatus: "PENDING",
						roleSyncStatus: "PENDING",
						updatedAt: now,
					},
				})
				.run();
		}
		return this.get(guildId, userId)!;
	}

	markLeft(guildId: string, userId: string, now = Date.now()): void {
		const row = this.get(guildId, userId);
		if (!row) return;
		this.database.db
			.update(registrations)
			.set({
				isPresent: false,
				leftAt: now,
				retentionExpiresAt: now + this.retentionDays * 86_400_000,
				updatedAt: now,
			})
			.where(and(eq(registrations.guildId, guildId), eq(registrations.userId, userId)))
			.run();
	}

	createAttempt(guildId: string, userId: string, actorUserId: string, now = Date.now()): string {
		const id = crypto.randomUUID();
		this.database.db
			.insert(registrationAttempts)
			.values({
				id,
				guildId,
				userId,
				actorUserId,
				createdAt: now,
				expiresAt: now + 10 * 60_000,
			})
			.onConflictDoUpdate({
				target: [registrationAttempts.guildId, registrationAttempts.userId],
				set: { id, actorUserId, createdAt: now, expiresAt: now + 10 * 60_000 },
			})
			.run();
		return id;
	}

	removeAttempt(id: string): void {
		this.database.db.delete(registrationAttempts).where(eq(registrationAttempts.id, id)).run();
	}

	saveRegistered(input: SaveRegistrationInput): Registration {
		if (input.nameVisibility === "VISIBLE" && !input.displayName?.trim()) throw new Error("VISIBLE_REQUIRES_NAME");
		if (input.nameVisibility === "HIDDEN" && input.displayName !== null) throw new Error("HIDDEN_REQUIRES_NULL_NAME");
		if (input.overrideDuplicate && !input.overrideAuthorized) throw new Error("DUPLICATE_OVERRIDE_FORBIDDEN");
		const now = input.now ?? Date.now();
		return this.database.sqlite.transaction(() => {
			const conflict = this.database.db
				.select({ userId: registrations.userId })
				.from(registrations)
				.where(
					and(
						eq(registrations.guildId, input.guildId),
						eq(registrations.status, "REGISTERED"),
						eq(registrations.puuid, input.identity.puuid),
						ne(registrations.userId, input.userId)
					)
				)
				.get();
			if (conflict && !input.overrideDuplicate) throw new DuplicatePuuidError("DUPLICATE_PUUID");
			const existing = this.get(input.guildId, input.userId);
			const version = (existing?.stateVersion ?? 0) + 1;
			if (existing?.displayName && input.nameVisibility === "HIDDEN") {
				this.database.db
					.insert(retainedRegistrationData)
					.values({
						id: crypto.randomUUID(),
						guildId: input.guildId,
						userId: input.userId,
						dataType: "DISPLAY_NAME",
						value: existing.displayName,
						reason: "VISIBILITY_CHANGED_TO_HIDDEN",
						retainedAt: now,
						purgeAt: now + this.retentionDays * 86_400_000,
						createdByAction: "REGISTRATION_UPDATED",
					})
					.run();
			}
			const nextSync = deterministicNextSync(input.guildId, input.userId, input.identity.puuid, now);
			this.database.db
				.insert(registrations)
				.values({
					guildId: input.guildId,
					userId: input.userId,
					discordUsernameSnapshot: input.discordUsername,
					status: "REGISTERED",
					isPresent: true,
					joinedAt: existing?.joinedAt ?? now,
					unregisteredSince: null,
					displayName: input.displayName?.trim() ?? null,
					nameVisibility: input.nameVisibility,
					...input.identity,
					registeredAt: existing?.registeredAt ?? now,
					nextRiotSyncAt: nextSync,
					riotSyncStatus: "PENDING",
					nicknameSyncStatus: "PENDING",
					roleSyncStatus: "PENDING",
					stateVersion: version,
					duplicatePuuidOverride: input.overrideDuplicate ?? false,
					duplicateOverrideActorId: input.overrideDuplicate ? input.actorUserId : null,
					duplicateOverrideAt: input.overrideDuplicate ? now : null,
					createdAt: existing?.createdAt ?? now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [registrations.guildId, registrations.userId],
					set: {
						discordUsernameSnapshot: input.discordUsername,
						status: "REGISTERED",
						isPresent: true,
						leftAt: null,
						retentionExpiresAt: null,
						unregisteredSince: null,
						displayName: input.displayName?.trim() ?? null,
						nameVisibility: input.nameVisibility,
						puuid: input.identity.puuid,
						gameName: input.identity.gameName,
						tagLine: input.identity.tagLine,
						riotId: input.identity.riotId,
						platformRegion: input.identity.platformRegion,
						accountRoutingGroup: input.identity.accountRoutingGroup,
						opggUrl: input.identity.opggUrl,
						registeredAt: existing?.registeredAt ?? now,
						nextRiotSyncAt: nextSync,
						riotSyncStatus: "PENDING",
						nicknameSyncStatus: "PENDING",
						roleSyncStatus: "PENDING",
						stateVersion: version,
						duplicatePuuidOverride: input.overrideDuplicate ?? false,
						duplicateOverrideActorId: input.overrideDuplicate ? input.actorUserId : null,
						duplicateOverrideAt: input.overrideDuplicate ? now : null,
						updatedAt: now,
					},
				})
				.run();
			this.enqueueReconcile(input.guildId, input.userId, version, input.priority ?? operationPriorities.REGISTRATION, now);
			this.audit(
				input.guildId,
				input.userId,
				input.actorUserId,
				existing ? "REGISTRATION_UPDATED" : "REGISTRATION_COMPLETED",
				"SUCCESS",
				{
					visibility: input.nameVisibility,
					puuidMasked: maskPuuid(input.identity.puuid),
					duplicateOverride: Boolean(input.overrideDuplicate),
				},
				now
			);
			return this.get(input.guildId, input.userId)!;
		})();
	}

	saveVerifiedWithoutRiot(input: SaveVerifiedWithoutRiotInput): Registration {
		const displayName = input.displayName.trim();
		if (!displayName) throw new Error("VERIFIED_NO_RIOT_REQUIRES_NAME");
		const now = input.now ?? Date.now();
		return this.database.sqlite.transaction(() => {
			const existing = this.get(input.guildId, input.userId);
			if (!input.migrationJobId && existing?.status === "REGISTERED") this.retainIdentity(existing, "ADMIN_NICKNAME_VERIFIED_NO_RIOT", now);
			const version = (existing?.stateVersion ?? 0) + 1;
			const migrationSource = input.migrationJobId ? "LEGACY_NICKNAME" : null;
			const riotNotFound = input.reason === "RIOT_NOT_FOUND" || input.reason === "ADMIN_RIOT_NOT_FOUND";
			this.database.db
				.insert(registrations)
				.values({
					guildId: input.guildId,
					userId: input.userId,
					discordUsernameSnapshot: input.discordUsername,
					status: "VERIFIED_NO_RIOT",
					isPresent: true,
					joinedAt: existing?.joinedAt ?? now,
					unregisteredSince: null,
					displayName,
					nameVisibility: "VISIBLE",
					registeredAt: existing?.registeredAt ?? now,
					riotSyncStatus: "NOT_REQUIRED",
					nicknameSyncStatus: "PENDING",
					roleSyncStatus: "PENDING",
					migrationSource,
					originalMigrationNickname: input.originalNickname ?? null,
					migrationJobId: input.migrationJobId ?? null,
					stateVersion: version,
					lastFailureCode: riotNotFound ? "RIOT_ID_OUTDATED" : null,
					lastFailureAt: riotNotFound ? now : null,
					createdAt: existing?.createdAt ?? now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [registrations.guildId, registrations.userId],
					set: {
						discordUsernameSnapshot: input.discordUsername,
						status: "VERIFIED_NO_RIOT",
						isPresent: true,
						leftAt: null,
						retentionExpiresAt: null,
						unregisteredSince: null,
						displayName,
						nameVisibility: "VISIBLE",
						puuid: null,
						gameName: null,
						tagLine: null,
						riotId: null,
						platformRegion: null,
						accountRoutingGroup: null,
						opggUrl: null,
						registeredAt: existing?.registeredAt ?? now,
						lastRiotSyncAt: null,
						nextRiotSyncAt: null,
						riotSyncStatus: "NOT_REQUIRED",
						riotSyncFailureCount: 0,
						lastRiotSyncErrorCode: null,
						nicknameSyncStatus: "PENDING",
						roleSyncStatus: "PENDING",
						migrationSource,
						originalMigrationNickname: input.originalNickname ?? null,
						migrationJobId: input.migrationJobId ?? null,
						stateVersion: version,
						duplicatePuuidOverride: false,
						duplicateOverrideActorId: null,
						duplicateOverrideAt: null,
						lastFailureCode: riotNotFound ? "RIOT_ID_OUTDATED" : null,
						lastFailureAt: riotNotFound ? now : null,
						updatedAt: now,
					},
				})
				.run();
			this.enqueueReconcile(input.guildId, input.userId, version, input.priority ?? operationPriorities.MIGRATION, now);
			this.audit(
				input.guildId,
				input.userId,
				input.actorUserId,
				input.migrationJobId ? "MIGRATION_VERIFIED_WITHOUT_RIOT" : "ADMIN_NICKNAME_VERIFIED_WITHOUT_RIOT",
				"SUCCESS",
				{ reason: input.reason },
				now
			);
			return this.get(input.guildId, input.userId)!;
		})();
	}

	unregister(guildId: string, userId: string, actorUserId: string, now = Date.now()): Registration {
		return this.database.sqlite.transaction(() => {
			const existing = this.get(guildId, userId);
			if (!existing) throw new Error("REGISTRATION_NOT_FOUND");
			this.retainIdentity(existing, "UNREGISTERED", now);
			const version = existing.stateVersion + 1;
			this.database.db
				.update(registrations)
				.set({
					status: "UNREGISTERED",
					unregisteredSince: now,
					displayName: null,
					nameVisibility: null,
					puuid: null,
					gameName: null,
					tagLine: null,
					riotId: null,
					platformRegion: null,
					accountRoutingGroup: null,
					opggUrl: null,
					registeredAt: null,
					nextRiotSyncAt: null,
					riotSyncStatus: "NOT_REQUIRED",
					nicknameSyncStatus: "PENDING",
					roleSyncStatus: "PENDING",
					duplicatePuuidOverride: false,
					duplicateOverrideActorId: null,
					duplicateOverrideAt: null,
					stateVersion: version,
					updatedAt: now,
				})
				.where(and(eq(registrations.guildId, guildId), eq(registrations.userId, userId)))
				.run();
			this.enqueueReconcile(guildId, userId, version, operationPriorities.STAFF, now);
			this.audit(guildId, userId, actorUserId, "USER_UNREGISTERED", "SUCCESS", {}, now);
			return this.get(guildId, userId)!;
		})();
	}

	setPendingMigration(
		guildId: string,
		userId: string,
		username: string,
		joinedAt: number,
		migrationJobId: string,
		originalNickname: string | null,
		now = Date.now()
	): Registration {
		const existing = this.get(guildId, userId);
		const version = (existing?.stateVersion ?? 0) + 1;
		this.database.db
			.insert(registrations)
			.values({
				guildId,
				userId,
				discordUsernameSnapshot: username,
				status: "PENDING_VERIFICATION",
				isPresent: true,
				joinedAt,
				displayName: null,
				nameVisibility: null,
				migrationSource: "LEGACY_NICKNAME",
				originalMigrationNickname: originalNickname,
				migrationJobId,
				stateVersion: version,
				nicknameSyncStatus: "NOT_REQUIRED",
				roleSyncStatus: "NOT_REQUIRED",
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [registrations.guildId, registrations.userId],
				set: {
					discordUsernameSnapshot: username,
					status: "PENDING_VERIFICATION",
					isPresent: true,
					joinedAt,
					displayName: null,
					nameVisibility: null,
					migrationSource: "LEGACY_NICKNAME",
					originalMigrationNickname: originalNickname,
					migrationJobId,
					stateVersion: version,
					nicknameSyncStatus: "NOT_REQUIRED",
					roleSyncStatus: "NOT_REQUIRED",
					updatedAt: now,
				},
			})
			.run();
		return this.get(guildId, userId)!;
	}

	updateCanonicalRiotIdentity(row: Registration, gameName: string, tagLine: string, nextSyncAt: number, now = Date.now()): boolean {
		const changed = row.gameName !== gameName || row.tagLine !== tagLine;
		const version = row.stateVersion + (changed ? 1 : 0);
		this.database.sqlite.transaction(() => {
			this.database.db
				.update(registrations)
				.set({
					gameName,
					tagLine,
					riotId: `${gameName}#${tagLine}`,
					opggUrl: buildOpggUrl(row.platformRegion!, gameName, tagLine),
					lastRiotSyncAt: now,
					nextRiotSyncAt: nextSyncAt,
					riotSyncStatus: "SUCCEEDED",
					riotSyncFailureCount: 0,
					lastRiotSyncErrorCode: null,
					...(changed ? { stateVersion: version, nicknameSyncStatus: "PENDING" as const } : {}),
					updatedAt: now,
				})
				.where(and(eq(registrations.guildId, row.guildId), eq(registrations.userId, row.userId)))
				.run();
			if (changed) this.enqueueReconcile(row.guildId, row.userId, version, operationPriorities.RIOT_SYNC, now);
		})();
		return changed;
	}

	deletePersonalData(guildId: string, userId: string, actorUserId: string, now = Date.now()): void {
		this.database.sqlite.transaction(() => {
			this.database.db
				.delete(retainedRegistrationData)
				.where(and(eq(retainedRegistrationData.guildId, guildId), eq(retainedRegistrationData.userId, userId)))
				.run();
			this.database.db
				.update(auditEvents)
				.set({ metadata: "{}" })
				.where(and(eq(auditEvents.guildId, guildId), eq(auditEvents.targetUserId, userId)))
				.run();
			const existing = this.get(guildId, userId);
			if (!existing) return;
			if (!existing.isPresent) {
				this.database.db
					.delete(registrations)
					.where(and(eq(registrations.guildId, guildId), eq(registrations.userId, userId)))
					.run();
				return;
			}
			const version = existing.stateVersion + 1;
			this.database.db
				.update(registrations)
				.set({
					discordUsernameSnapshot: null,
					status: "UNREGISTERED",
					unregisteredSince: now,
					displayName: null,
					nameVisibility: null,
					puuid: null,
					gameName: null,
					tagLine: null,
					riotId: null,
					platformRegion: null,
					accountRoutingGroup: null,
					opggUrl: null,
					registeredAt: null,
					nextRiotSyncAt: null,
					riotSyncStatus: "NOT_REQUIRED",
					nicknameSyncStatus: "PENDING",
					roleSyncStatus: "PENDING",
					duplicatePuuidOverride: false,
					duplicateOverrideActorId: null,
					duplicateOverrideAt: null,
					stateVersion: version,
					updatedAt: now,
				})
				.where(and(eq(registrations.guildId, guildId), eq(registrations.userId, userId)))
				.run();
			this.enqueueReconcile(guildId, userId, version, operationPriorities.STAFF, now);
			this.audit(guildId, userId, actorUserId, "REGISTRATION_DATA_DELETED", "SUCCESS", {}, now);
		})();
	}

	dueCleanup(cutoff: number): Registration[] {
		return this.database.db
			.select()
			.from(registrations)
			.where(
				and(
					eq(registrations.status, "UNREGISTERED"),
					eq(registrations.isPresent, true),
					isNotNull(registrations.unregisteredSince),
					lte(registrations.unregisteredSince, cutoff)
				)
			)
			.all();
	}

	dueRiotSync(now: number, limit: number): Registration[] {
		return this.database.db
			.select()
			.from(registrations)
			.where(and(eq(registrations.status, "REGISTERED"), eq(registrations.isPresent, true), isNotNull(registrations.nextRiotSyncAt), lte(registrations.nextRiotSyncAt, now)))
			.limit(limit)
			.all();
	}

	purgeRetained(now = Date.now()): number {
		const deleted = this.database.db.delete(retainedRegistrationData).where(lte(retainedRegistrationData.purgeAt, now)).run().changes;
		const expired = this.database.db
			.select()
			.from(registrations)
			.where(and(eq(registrations.isPresent, false), isNotNull(registrations.retentionExpiresAt), lte(registrations.retentionExpiresAt, now)))
			.all();
		for (const row of expired)
			this.database.db
				.delete(registrations)
				.where(and(eq(registrations.guildId, row.guildId), eq(registrations.userId, row.userId)))
				.run();
		this.database.db.delete(registrationAttempts).where(lt(registrationAttempts.expiresAt, now)).run();
		return deleted + expired.length;
	}

	hasActiveAttempt(guildId: string, userId: string, now = Date.now()): boolean {
		return Boolean(
			this.database.db
				.select({ id: registrationAttempts.id })
				.from(registrationAttempts)
				.where(and(eq(registrationAttempts.guildId, guildId), eq(registrationAttempts.userId, userId), gt(registrationAttempts.expiresAt, now)))
				.get()
		);
	}

	updateSync(
		guildId: string,
		userId: string,
		fields: Partial<
			Pick<
				Registration,
				| "lastRiotSyncAt"
				| "nextRiotSyncAt"
				| "riotSyncStatus"
				| "riotSyncFailureCount"
				| "lastRiotSyncErrorCode"
				| "lastNicknameSyncAt"
				| "nicknameSyncStatus"
				| "lastRoleSyncAt"
				| "roleSyncStatus"
				| "gameName"
				| "tagLine"
				| "riotId"
				| "opggUrl"
			>
		>
	): void {
		this.database.db
			.update(registrations)
			.set({ ...fields, updatedAt: Date.now() })
			.where(and(eq(registrations.guildId, guildId), eq(registrations.userId, userId)))
			.run();
	}

	requestReconciliation(guildId: string, userId: string, priority = operationPriorities.REPAIR, now = Date.now()): boolean {
		const row = this.get(guildId, userId);
		if (!row) return false;
		this.enqueueReconcile(guildId, userId, row.stateVersion, priority, now);
		return true;
	}

	private enqueueReconcile(guildId: string, userId: string, stateVersion: number, priority: number, now: number): void {
		const operationType: DiscordOperationType = "SET_NICKNAME";
		const key = `${guildId}:${userId}:RECONCILE`;
		this.database.db
			.insert(pendingOperations)
			.values({
				id: crypto.randomUUID(),
				guildId,
				userId,
				operationType,
				payload: JSON.stringify({ reconcile: true }),
				priority,
				stateVersion,
				deduplicationKey: key,
				nextAttemptAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: pendingOperations.deduplicationKey,
				set: {
					payload: JSON.stringify({ reconcile: true }),
					priority,
					stateVersion,
					attemptCount: 0,
					nextAttemptAt: now,
					lastErrorCode: null,
					terminal: false,
					updatedAt: now,
				},
			})
			.run();
	}

	private retainIdentity(row: Registration, reason: string, now: number): void {
		const values = [
			["DISPLAY_NAME", row.displayName],
			["PUUID", row.puuid],
			["RIOT_ID", row.riotId],
			["OPGG_URL", row.opggUrl],
		] as const;
		for (const [dataType, value] of values)
			if (value)
				this.database.db
					.insert(retainedRegistrationData)
					.values({
						id: crypto.randomUUID(),
						guildId: row.guildId,
						userId: row.userId,
						dataType,
						value,
						reason,
						retainedAt: now,
						purgeAt: now + this.retentionDays * 86_400_000,
						createdByAction: reason,
					})
					.run();
	}

	private audit(guildId: string, targetUserId: string, actorUserId: string, action: string, result: string, metadata: Record<string, unknown>, now: number): void {
		this.database.db
			.insert(auditEvents)
			.values({
				id: crypto.randomUUID(),
				guildId,
				targetUserId,
				actorUserId,
				action,
				result,
				metadata: JSON.stringify(metadata),
				correlationId: crypto.randomUUID(),
				createdAt: now,
			})
			.run();
	}
}

function deterministicNextSync(guildId: string, userId: string, puuid: string, now: number): number {
	let hash = 2166136261;
	for (const char of `${guildId}:${userId}:${puuid}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	return now + 86_400_000 + (Math.abs(hash) % (6 * 86_400_000));
}

function maskPuuid(puuid: string): string {
	return puuid.length > 12 ? `${puuid.slice(0, 6)}…${puuid.slice(-4)}` : "••••";
}
