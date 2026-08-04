import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { AnyBulkWriteOperation, Document } from "mongodb";
import pino from "pino";
import { loadConfig } from "../config/load.js";
import { openReadOnlyDatabase } from "./client.js";
import { MongoDatabaseContext, mongoCollections } from "./mongo-client.js";
import {
	auditEvents,
	championMasteries,
	discordAuditOutbox,
	leagueProfiles,
	masterySnapshots,
	migrationItems,
	migrationJobs,
	pendingOperations,
	registrationAttempts,
	registrations,
	retainedRegistrationData,
	workerLeases,
} from "./schema/index.js";

const AUDIT_RETENTION_MS = 180 * 86_400_000;
const IMPORT_MARKER_ID = "sqlite-import-v1";
const BATCH_SIZE = 500;

interface ImportMarker extends Document {
	_id: string;
	fingerprint: string;
	status: "RUNNING" | "COMPLETED";
	startedAt: Date;
	completedAt?: Date;
	counts?: Record<string, number>;
}

interface ImportDefinition {
	name: string;
	table: AnySQLiteTable;
	filter: (row: Document) => Document;
	transform?: (row: Document) => Document;
}

const definitions: ImportDefinition[] = [
	{ name: mongoCollections.registrations, table: registrations, filter: (row) => ({ guildId: row.guildId, userId: row.userId }) },
	{ name: mongoCollections.retainedRegistrationData, table: retainedRegistrationData, filter: by("id"), transform: (row) => ({ ...row, purgeAtDate: new Date(numberField(row, "purgeAt")) }) },
	{ name: mongoCollections.migrationJobs, table: migrationJobs, filter: by("id") },
	{ name: mongoCollections.migrationItems, table: migrationItems, filter: by("id") },
	{ name: mongoCollections.pendingOperations, table: pendingOperations, filter: by("id") },
	{
		name: mongoCollections.auditEvents,
		table: auditEvents,
		filter: by("id"),
		transform: (row) => ({ ...row, expiresAt: new Date(numberField(row, "createdAt") + AUDIT_RETENTION_MS) }),
	},
	{ name: mongoCollections.discordAuditOutbox, table: discordAuditOutbox, filter: by("eventId") },
	{
		name: mongoCollections.registrationAttempts,
		table: registrationAttempts,
		filter: by("id"),
		transform: (row) => ({ ...row, expiresAtDate: new Date(numberField(row, "expiresAt")) }),
	},
	{ name: mongoCollections.workerLeases, table: workerLeases, filter: by("name") },
	{ name: mongoCollections.leagueProfiles, table: leagueProfiles, filter: (row) => ({ guildId: row.guildId, userId: row.userId }) },
	{
		name: mongoCollections.championMasteries,
		table: championMasteries,
		filter: (row) => ({ guildId: row.guildId, userId: row.userId, championId: row.championId }),
	},
	{
		name: mongoCollections.masterySnapshots,
		table: masterySnapshots,
		filter: by("id"),
		transform: (row) => ({ ...row, delta: 0, capturedAtDate: new Date(numberField(row, "capturedAt")) }),
	},
];

async function main(): Promise<void> {
	const config = loadConfig();
	const logger = pino({ level: config.LOG_LEVEL });
	const sqlite = openReadOnlyDatabase(config.SQLITE_IMPORT_PATH);
	const mongo = new MongoDatabaseContext(config.MONGODB_URI, config.MONGODB_DATABASE, config.MASTERY_HISTORY_RETENTION_DAYS, logger);
	try {
		if (sqlite.sqlite.pragma("quick_check", { simple: true }) !== "ok") throw new Error("SQLITE_SOURCE_INTEGRITY_CHECK_FAILED");
		const fingerprint = await sourceFingerprint(sqlite.path);
		await mongo.connect();
		const metadata = mongo.db.collection<ImportMarker>("system_metadata");
		const marker = await metadata.findOne({ _id: IMPORT_MARKER_ID });
		if (marker && marker.fingerprint !== fingerprint) throw new Error("MONGODB_IMPORT_SOURCE_CHANGED");
		if (!marker) {
			const occupied = await occupiedCollections(mongo);
			if (occupied.length) throw new Error(`MONGODB_IMPORT_TARGET_NOT_EMPTY:${occupied.join(",")}`);
			await metadata.insertOne({ _id: IMPORT_MARKER_ID, fingerprint, status: "RUNNING", startedAt: new Date() });
		}

		const counts: Record<string, number> = {};
		for (const definition of definitions) {
			const rows = sqlite.db.select().from(definition.table).all() as unknown as Document[];
			counts[definition.name] = rows.length;
			for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
				const operations: AnyBulkWriteOperation<Document>[] = rows.slice(offset, offset + BATCH_SIZE).map((source) => {
					const replacement = definition.transform ? definition.transform(source) : source;
					return { replaceOne: { filter: definition.filter(replacement), replacement, upsert: true } };
				});
				if (operations.length) await mongo.db.collection(definition.name).bulkWrite(operations, { ordered: true });
			}
			const actual = await mongo.db.collection(definition.name).countDocuments();
			if (actual !== rows.length) throw new Error(`MONGODB_IMPORT_COUNT_MISMATCH:${definition.name}:${rows.length}:${actual}`);
			logger.info({ collection: definition.name, documents: actual }, "SQLite collection imported into MongoDB");
		}

		await metadata.updateOne(
			{ _id: IMPORT_MARKER_ID, fingerprint },
			{ $set: { status: "COMPLETED", completedAt: new Date(), counts } }
		);
		console.log("SQLite-Import nach MongoDB erfolgreich und vollständig geprüft.");
	} finally {
		sqlite.sqlite.close();
		await mongo.close().catch(() => undefined);
	}
}

function by(field: string): (row: Document) => Document {
	return (row) => ({ [field]: row[field] });
}

function numberField(row: Document, field: string): number {
	const value = row[field];
	if (typeof value !== "number") throw new Error(`SQLITE_IMPORT_INVALID_NUMBER:${field}`);
	return value;
}

async function occupiedCollections(mongo: MongoDatabaseContext): Promise<string[]> {
	const occupied: string[] = [];
	for (const definition of definitions) {
		if ((await mongo.db.collection(definition.name).estimatedDocumentCount()) > 0) occupied.push(definition.name);
	}
	return occupied;
}

async function sourceFingerprint(path: string): Promise<string> {
	const hash = createHash("sha256");
	for (const source of [path, `${path}-wal`]) {
		if (!existsSync(source)) continue;
		for await (const chunk of createReadStream(source)) hash.update(chunk);
	}
	return hash.digest("hex");
}

await main();
