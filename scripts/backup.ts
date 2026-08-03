import Database from "better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const source = resolve(process.env.DATABASE_PATH ?? "./data/bot.sqlite");
const destinationDirectory = resolve(process.env.BACKUP_PATH ?? "./backups");
mkdirSync(destinationDirectory, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = join(destinationDirectory, `${basename(source)}.${stamp}.backup`);
const database = new Database(source, { readonly: true, fileMustExist: true });
try {
	const health = database.pragma("quick_check", { simple: true });
	if (health !== "ok") throw new Error(`SQLite quick_check failed: ${String(health)}`);
	await database.backup(destination);
	try {
		chmodSync(destination, 0o600);
	} catch {
		/* POSIX-only hardening. */
	}
	const copy = new Database(destination, { readonly: true });
	try {
		if (copy.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Backup integrity check failed");
	} finally {
		copy.close();
	}
	console.log(destination);
} finally {
	database.close();
}
