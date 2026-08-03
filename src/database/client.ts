import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema/index.js";

export type DatabaseContext = ReturnType<typeof createDatabase>;

export function createDatabase(databasePath: string) {
	const resolved = resolve(databasePath);
	mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
	const sqlite = new Database(resolved);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma("synchronous = NORMAL");
	try {
		chmodSync(resolved, 0o600);
	} catch {
		/* Windows and restrictive filesystems may ignore POSIX modes. */
	}
	return { sqlite, db: drizzle(sqlite, { schema }), path: resolved };
}

export function assertDatabaseHealthy(context: DatabaseContext): void {
	const result = context.sqlite.pragma("quick_check", { simple: true });
	if (result !== "ok") throw new Error(`SQLite quick_check failed: ${String(result)}`);
}
