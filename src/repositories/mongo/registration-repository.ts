import type { ClientSession, WithId } from "mongodb";
import { mongoCollections, type MongoDatabaseContext } from "../../database/mongo-client.js";
import type { AuditEvent, DiscordAuditOutboxRow, PendingOperation, Registration } from "../../database/schema/index.js";
import { buildOpggUrl } from "../../parsers/opgg-parser.js";
import type { DiscordOperationType, NameVisibility, RegistrationIdentity } from "../../types/domain.js";
import { operationPriorities } from "../../types/domain.js";
import { DuplicatePuuidError, type SaveRegistrationInput, type SaveVerifiedWithoutRiotInput } from "../registration-repository.js";
import { isDuplicateKey, withoutMongoId, withoutMongoIds } from "./helpers.js";

interface RetainedDataDocument {
	id: string;
	guildId: string;
	userId: string;
	dataType: string;
	value: string;
	reason: string;
	retainedAt: number;
	purgeAt: number;
	purgeAtDate: Date;
	createdByAction: string;
}

interface RegistrationAttemptDocument {
	id: string;
	guildId: string;
	userId: string;
	actorUserId: string;
	expiresAt: number;
	expiresAtDate: Date;
	createdAt: number;
}

export { DuplicatePuuidError } from "../registration-repository.js";

export class RegistrationRepository {
	constructor(
		private readonly database: MongoDatabaseContext,
		private readonly retentionDays: number,
		private readonly discordAuditEnabled = false
	) {}

	async get(guildId: string, userId: string, session?: ClientSession): Promise<Registration | undefined> {
		const row = await this.database.collection<Registration>(mongoCollections.registrations).findOne(
			{ guildId, userId },
			{ ...(session ? { session } : {}) }
		);
		return withoutMongoId<Registration>(row as WithId<Registration> | null);
	}

	async findRegisteredByRiotId(guildId: string, riotId: string, excludingUserId?: string): Promise<Registration | undefined> {
		const row = await this.database.collection<Registration>(mongoCollections.registrations).findOne(
				{ guildId, status: "REGISTERED", riotId: { $regex: `^${escapeRegExp(riotId)}$`, $options: "i" }, ...(excludingUserId ? { userId: { $ne: excludingUserId } } : {}) },
				{ sort: { duplicatePuuidOverride: 1, registeredAt: 1, userId: 1 } }
			);
		return withoutMongoId<Registration>(row as WithId<Registration> | null);
	}

	async upsertJoined(guildId: string, userId: string, username: string, joinedAt: number): Promise<Registration> {
		return this.database.transaction(async (session) => {
			const collection = this.database.collection<Registration>(mongoCollections.registrations);
			const existing = await this.get(guildId, userId, session);
			const now = Date.now();
			if (existing?.isPresent) return existing;
			if ((existing?.status === "REGISTERED" || existing?.status === "VERIFIED_NO_RIOT") && (!existing.retentionExpiresAt || existing.retentionExpiresAt > now)) {
				await collection.updateOne(
					{ guildId, userId },
					{ $set: { isPresent: true, joinedAt, leftAt: null, retentionExpiresAt: null, discordUsernameSnapshot: username, stateVersion: existing.stateVersion + 1, nicknameSyncStatus: "PENDING", roleSyncStatus: "PENDING", updatedAt: now } },
					{ session }
				);
			} else {
				const next = unregisteredDocument(guildId, userId, username, joinedAt, existing, now);
				await collection.replaceOne({ guildId, userId }, next, { upsert: true, session });
			}
			return (await this.get(guildId, userId, session))!;
		});
	}

	async markLeft(guildId: string, userId: string, now = Date.now()): Promise<void> {
		await this.database.collection<Registration>(mongoCollections.registrations).updateOne(
			{ guildId, userId },
			{ $set: { isPresent: false, leftAt: now, retentionExpiresAt: now + this.retentionDays * 86_400_000, updatedAt: now } }
		);
	}

	async createAttempt(guildId: string, userId: string, actorUserId: string, now = Date.now()): Promise<string> {
		const id = crypto.randomUUID();
		const expiresAt = now + 10 * 60_000;
		await this.database.collection<RegistrationAttemptDocument>(mongoCollections.registrationAttempts).updateOne(
			{ guildId, userId },
			{ $set: { id, actorUserId, createdAt: now, expiresAt, expiresAtDate: new Date(expiresAt) }, $setOnInsert: { guildId, userId } },
			{ upsert: true }
		);
		return id;
	}

	async removeAttempt(id: string): Promise<void> {
		await this.database.collection<RegistrationAttemptDocument>(mongoCollections.registrationAttempts).deleteOne({ id });
	}

	async saveRegistered(input: SaveRegistrationInput): Promise<Registration> {
		if (input.nameVisibility === "VISIBLE" && !input.displayName?.trim()) throw new Error("VISIBLE_REQUIRES_NAME");
		if (input.nameVisibility === "HIDDEN" && input.displayName !== null) throw new Error("HIDDEN_REQUIRES_NULL_NAME");
		if (input.overrideDuplicate && !input.overrideAuthorized) throw new Error("DUPLICATE_OVERRIDE_FORBIDDEN");
		const now = input.now ?? Date.now();
		try {
			return await this.database.transaction(async (session) => {
				const collection = this.database.collection<Registration>(mongoCollections.registrations);
				const conflict = withoutMongoId(
					await collection.findOne(
						{ guildId: input.guildId, status: "REGISTERED", puuid: input.identity.puuid, userId: { $ne: input.userId } },
						{ sort: { duplicatePuuidOverride: 1, registeredAt: 1, userId: 1 }, session }
					)
				);
				if (conflict && !input.overrideDuplicate) throw new DuplicatePuuidError(conflict.userId);
				const existing = await this.get(input.guildId, input.userId, session);
				const version = (existing?.stateVersion ?? 0) + 1;
				if (existing?.displayName && input.nameVisibility === "HIDDEN") await this.retainValue(input.guildId, input.userId, "DISPLAY_NAME", existing.displayName, "VISIBILITY_CHANGED_TO_HIDDEN", now, session);
				const nextSync = deterministicNextSync(input.guildId, input.userId, input.identity.puuid, now);
				const next = registeredDocument(input, existing, version, nextSync, now);
				await collection.replaceOne({ guildId: input.guildId, userId: input.userId }, next, { upsert: true, session });
				await this.enqueueReconcile(input.guildId, input.userId, version, input.priority ?? operationPriorities.REGISTRATION, now, session);
				await this.audit(
					input.guildId,
					input.userId,
					input.actorUserId,
					existing ? "REGISTRATION_UPDATED" : "REGISTRATION_COMPLETED",
					"SUCCESS",
					{ visibility: input.nameVisibility, puuidMasked: maskPuuid(input.identity.puuid), duplicateOverride: Boolean(input.overrideDuplicate) },
					now,
					session
				);
				return next;
			});
		} catch (error) {
			if (isDuplicateKey(error)) {
				const conflict = withoutMongoId(
					await this.database.collection<Registration>(mongoCollections.registrations).findOne({ guildId: input.guildId, status: "REGISTERED", puuid: input.identity.puuid, userId: { $ne: input.userId } })
				);
				throw new DuplicatePuuidError(conflict?.userId ?? null);
			}
			throw error;
		}
	}

	async saveVerifiedWithoutRiot(input: SaveVerifiedWithoutRiotInput): Promise<Registration> {
		const displayName = input.displayName.trim();
		if (!displayName) throw new Error("VERIFIED_NO_RIOT_REQUIRES_NAME");
		const now = input.now ?? Date.now();
		return this.database.transaction(async (session) => {
			const existing = await this.get(input.guildId, input.userId, session);
			if (!input.migrationJobId && existing?.status === "REGISTERED") await this.retainIdentity(existing, "ADMIN_NICKNAME_VERIFIED_NO_RIOT", now, session);
			const version = (existing?.stateVersion ?? 0) + 1;
			const riotNotFound = input.reason === "RIOT_NOT_FOUND" || input.reason === "ADMIN_RIOT_NOT_FOUND";
			const next = verifiedWithoutRiotDocument(input, existing, version, displayName, riotNotFound, now);
			await this.database.collection<Registration>(mongoCollections.registrations).replaceOne({ guildId: input.guildId, userId: input.userId }, next, { upsert: true, session });
			await this.enqueueReconcile(input.guildId, input.userId, version, input.priority ?? operationPriorities.MIGRATION, now, session);
			await this.audit(
				input.guildId,
				input.userId,
				input.actorUserId,
				input.migrationJobId ? "MIGRATION_VERIFIED_WITHOUT_RIOT" : "ADMIN_NICKNAME_VERIFIED_WITHOUT_RIOT",
				"SUCCESS",
				{ reason: input.reason },
				now,
				session
			);
			return next;
		});
	}

	async unregister(guildId: string, userId: string, actorUserId: string, now = Date.now()): Promise<Registration> {
		return this.database.transaction(async (session) => {
			const existing = await this.get(guildId, userId, session);
			if (!existing) throw new Error("REGISTRATION_NOT_FOUND");
			await this.retainIdentity(existing, "UNREGISTERED", now, session);
			const version = existing.stateVersion + 1;
			const next = unregisteredDocument(guildId, userId, existing.discordUsernameSnapshot, existing.joinedAt, existing, now, version, now);
			await this.database.collection<Registration>(mongoCollections.registrations).replaceOne({ guildId, userId }, next, { session });
			await this.enqueueReconcile(guildId, userId, version, operationPriorities.STAFF, now, session);
			await this.audit(guildId, userId, actorUserId, "USER_UNREGISTERED", "SUCCESS", {}, now, session);
			return next;
		});
	}

	async setPendingMigration(
		guildId: string,
		userId: string,
		username: string,
		joinedAt: number,
		migrationJobId: string,
		originalNickname: string | null,
		now = Date.now()
	): Promise<Registration> {
		return this.database.transaction(async (session) => {
			const existing = await this.get(guildId, userId, session);
			const version = (existing?.stateVersion ?? 0) + 1;
			const next: Registration = {
				...unregisteredDocument(guildId, userId, username, joinedAt, existing, now, version),
				status: "PENDING_VERIFICATION",
				unregisteredSince: null,
				migrationSource: "LEGACY_NICKNAME",
				originalMigrationNickname: originalNickname,
				migrationJobId,
				nicknameSyncStatus: "NOT_REQUIRED",
				roleSyncStatus: "NOT_REQUIRED",
			};
			await this.database.collection<Registration>(mongoCollections.registrations).replaceOne({ guildId, userId }, next, { upsert: true, session });
			return next;
		});
	}

	async updateCanonicalRiotIdentity(row: Registration, gameName: string, tagLine: string, nextSyncAt: number, now = Date.now()): Promise<boolean> {
		const changed = row.gameName !== gameName || row.tagLine !== tagLine;
		const version = row.stateVersion + (changed ? 1 : 0);
		await this.database.transaction(async (session) => {
			await this.database.collection<Registration>(mongoCollections.registrations).updateOne(
				{ guildId: row.guildId, userId: row.userId },
				{
					$set: {
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
					},
				},
				{ session }
			);
			if (changed) await this.enqueueReconcile(row.guildId, row.userId, version, operationPriorities.RIOT_SYNC, now, session);
		});
		return changed;
	}

	async deletePersonalData(guildId: string, userId: string, actorUserId: string, now = Date.now()): Promise<void> {
		await this.database.transaction(async (session) => {
			const filter = { guildId, userId };
			await this.database.collection(mongoCollections.masterySnapshots).deleteMany(filter, { session });
			await this.database.collection(mongoCollections.championMasteries).deleteMany(filter, { session });
			await this.database.collection(mongoCollections.leagueProfiles).deleteMany(filter, { session });
			await this.database.collection<RetainedDataDocument>(mongoCollections.retainedRegistrationData).deleteMany(filter, { session });
			await this.database.collection<AuditEvent>(mongoCollections.auditEvents).updateMany({ guildId, targetUserId: userId }, { $set: { metadata: "{}" } }, { session });
			const existing = await this.get(guildId, userId, session);
			if (!existing) return;
			if (!existing.isPresent) {
				await this.database.collection<Registration>(mongoCollections.registrations).deleteOne(filter, { session });
				return;
			}
			const version = existing.stateVersion + 1;
			const next = unregisteredDocument(guildId, userId, null, existing.joinedAt, existing, now, version, now);
			await this.database.collection<Registration>(mongoCollections.registrations).replaceOne(filter, next, { session });
			await this.enqueueReconcile(guildId, userId, version, operationPriorities.STAFF, now, session);
			await this.audit(guildId, userId, actorUserId, "REGISTRATION_DATA_DELETED", "SUCCESS", {}, now, session);
		});
	}

	async dueCleanup(cutoff: number): Promise<Registration[]> {
		return withoutMongoIds(
			await this.database.collection<Registration>(mongoCollections.registrations).find({ status: "UNREGISTERED", isPresent: true, unregisteredSince: { $ne: null, $lte: cutoff } }).toArray()
		);
	}

	async dueRiotSync(now: number, limit: number): Promise<Registration[]> {
		return withoutMongoIds(
			await this.database
				.collection<Registration>(mongoCollections.registrations)
				.find({ status: "REGISTERED", isPresent: true, nextRiotSyncAt: { $ne: null, $lte: now } })
				.limit(limit)
				.toArray()
		);
	}

	async purgeRetained(now = Date.now()): Promise<number> {
		const retained = await this.database.collection<RetainedDataDocument>(mongoCollections.retainedRegistrationData).deleteMany({ purgeAt: { $lte: now } });
		const expired = withoutMongoIds(
			await this.database.collection<Registration>(mongoCollections.registrations).find({ isPresent: false, retentionExpiresAt: { $ne: null, $lte: now } }).toArray()
		);
		for (const row of expired)
			await this.database.transaction(async (session) => {
				const filter = { guildId: row.guildId, userId: row.userId };
				await this.database.collection(mongoCollections.masterySnapshots).deleteMany(filter, { session });
				await this.database.collection(mongoCollections.championMasteries).deleteMany(filter, { session });
				await this.database.collection(mongoCollections.leagueProfiles).deleteMany(filter, { session });
				await this.database.collection<Registration>(mongoCollections.registrations).deleteOne(filter, { session });
			});
		await this.database.collection<RegistrationAttemptDocument>(mongoCollections.registrationAttempts).deleteMany({ expiresAt: { $lt: now } });
		return retained.deletedCount + expired.length;
	}

	async hasActiveAttempt(guildId: string, userId: string, now = Date.now()): Promise<boolean> {
		return Boolean(await this.database.collection<RegistrationAttemptDocument>(mongoCollections.registrationAttempts).findOne({ guildId, userId, expiresAt: { $gt: now } }));
	}

	async updateSync(
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
	): Promise<void> {
		await this.database.collection<Registration>(mongoCollections.registrations).updateOne({ guildId, userId }, { $set: { ...fields, updatedAt: Date.now() } });
	}

	async requestReconciliation(guildId: string, userId: string, priority: number = operationPriorities.REPAIR, now = Date.now()): Promise<boolean> {
		const row = await this.get(guildId, userId);
		if (!row) return false;
		await this.enqueueReconcile(guildId, userId, row.stateVersion, priority, now);
		return true;
	}

	private async enqueueReconcile(guildId: string, userId: string, stateVersion: number, priority: number, now: number, session?: ClientSession): Promise<void> {
		const operationType: DiscordOperationType = "SET_NICKNAME";
		const deduplicationKey = `${guildId}:${userId}:RECONCILE`;
		await this.database.collection<PendingOperation>(mongoCollections.pendingOperations).updateOne(
			{ deduplicationKey },
			{
				$set: {
					guildId,
					userId,
					operationType,
					payload: JSON.stringify({ reconcile: true }),
					priority,
					stateVersion,
					attemptCount: 0,
					nextAttemptAt: now,
					lastErrorCode: null,
					terminal: false,
					leaseOwner: null,
					leaseExpiresAt: null,
					updatedAt: now,
				},
				$setOnInsert: { id: crypto.randomUUID(), deduplicationKey, createdAt: now },
			},
			{ upsert: true, ...(session ? { session } : {}) }
		);
	}

	private async retainIdentity(row: Registration, reason: string, now: number, session: ClientSession): Promise<void> {
		const values = [
			["DISPLAY_NAME", row.displayName],
			["PUUID", row.puuid],
			["RIOT_ID", row.riotId],
			["OPGG_URL", row.opggUrl],
		] as const;
		for (const [dataType, value] of values) if (value) await this.retainValue(row.guildId, row.userId, dataType, value, reason, now, session);
	}

	private async retainValue(guildId: string, userId: string, dataType: string, value: string, reason: string, now: number, session: ClientSession): Promise<void> {
		const purgeAt = now + this.retentionDays * 86_400_000;
		await this.database.collection<RetainedDataDocument>(mongoCollections.retainedRegistrationData).insertOne(
			{ id: crypto.randomUUID(), guildId, userId, dataType, value, reason, retainedAt: now, purgeAt, purgeAtDate: new Date(purgeAt), createdByAction: reason },
			{ session }
		);
	}

	private async audit(
		guildId: string,
		targetUserId: string,
		actorUserId: string,
		action: string,
		result: string,
		metadata: Record<string, unknown>,
		now: number,
		session: ClientSession
	): Promise<void> {
		const id = crypto.randomUUID();
		await this.database.collection<AuditEvent>(mongoCollections.auditEvents).insertOne(
			{
				id,
				guildId,
				targetUserId,
				actorUserId,
				action,
				result,
				metadata: JSON.stringify(metadata),
				correlationId: crypto.randomUUID(),
				schemaVersion: 1,
				createdAt: now,
				expiresAt: new Date(now + 180 * 86_400_000),
			} as AuditEvent & { expiresAt: Date },
			{ session }
		);
		if (this.discordAuditEnabled)
			await this.database.collection<DiscordAuditOutboxRow>(mongoCollections.discordAuditOutbox).insertOne(
				{ eventId: id, guildId, attemptCount: 0, nextAttemptAt: now, lastErrorCode: null, terminal: false, createdAt: now, updatedAt: now },
				{ session }
			);
	}
}

function registrationBase(guildId: string, userId: string, username: string | null, joinedAt: number, existing: Registration | undefined, now: number, version: number): Registration {
	return {
		guildId,
		userId,
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
		lastRiotSyncAt: null,
		nextRiotSyncAt: null,
		riotSyncStatus: "NOT_REQUIRED",
		riotSyncFailureCount: 0,
		lastRiotSyncErrorCode: null,
		lastNicknameSyncAt: existing?.lastNicknameSyncAt ?? null,
		nicknameSyncStatus: "PENDING",
		lastRoleSyncAt: existing?.lastRoleSyncAt ?? null,
		roleSyncStatus: "PENDING",
		migrationSource: null,
		originalMigrationNickname: null,
		migrationJobId: null,
		stateVersion: version,
		duplicatePuuidOverride: false,
		duplicateOverrideActorId: null,
		duplicateOverrideAt: null,
		lastFailureCode: null,
		lastFailureAt: null,
		cleanupClaimVersion: null,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
}

function unregisteredDocument(
	guildId: string,
	userId: string,
	username: string | null,
	joinedAt: number,
	existing: Registration | undefined,
	now: number,
	version = (existing?.stateVersion ?? 0) + 1,
	unregisteredSince = joinedAt
): Registration {
	return { ...registrationBase(guildId, userId, username, joinedAt, existing, now, version), unregisteredSince };
}

function registeredDocument(input: SaveRegistrationInput, existing: Registration | undefined, version: number, nextSync: number, now: number): Registration {
	return {
		...registrationBase(input.guildId, input.userId, input.discordUsername, existing?.joinedAt ?? now, existing, now, version),
		status: "REGISTERED",
		unregisteredSince: null,
		displayName: input.displayName?.trim() ?? null,
		nameVisibility: input.nameVisibility,
		...input.identity,
		registeredAt: existing?.registeredAt ?? now,
		nextRiotSyncAt: nextSync,
		riotSyncStatus: "PENDING",
		duplicatePuuidOverride: input.overrideDuplicate ?? false,
		duplicateOverrideActorId: input.overrideDuplicate ? input.actorUserId : null,
		duplicateOverrideAt: input.overrideDuplicate ? now : null,
	};
}

function verifiedWithoutRiotDocument(
	input: SaveVerifiedWithoutRiotInput,
	existing: Registration | undefined,
	version: number,
	displayName: string,
	riotNotFound: boolean,
	now: number
): Registration {
	return {
		...registrationBase(input.guildId, input.userId, input.discordUsername, existing?.joinedAt ?? now, existing, now, version),
		status: "VERIFIED_NO_RIOT",
		unregisteredSince: null,
		displayName,
		nameVisibility: "VISIBLE",
		registeredAt: existing?.registeredAt ?? now,
		riotSyncStatus: "NOT_REQUIRED",
		migrationSource: input.migrationJobId ? "LEGACY_NICKNAME" : null,
		originalMigrationNickname: input.originalNickname ?? null,
		migrationJobId: input.migrationJobId ?? null,
		lastFailureCode: riotNotFound ? "RIOT_ID_OUTDATED" : null,
		lastFailureAt: riotNotFound ? now : null,
	};
}

function deterministicNextSync(guildId: string, userId: string, puuid: string, now: number): number {
	let hash = 2166136261;
	for (const char of `${guildId}:${userId}:${puuid}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	return now + 86_400_000 + (Math.abs(hash) % (6 * 86_400_000));
}

function maskPuuid(puuid: string): string {
	return puuid.length > 12 ? `${puuid.slice(0, 6)}…${puuid.slice(-4)}` : "••••";
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
