import type { DatabaseContext } from "../database/client.js";

export class WorkerLeaseRepository {
	constructor(
		private readonly database: DatabaseContext,
		readonly owner = `${process.pid}:${crypto.randomUUID()}`
	) {}

	acquire(name: string, ttlMs: number, now = Date.now()): boolean {
		const result = this.database.sqlite
			.prepare(
				`
      INSERT INTO worker_leases(name, owner, expires_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at, updated_at=excluded.updated_at
      WHERE worker_leases.expires_at < ? OR worker_leases.owner = ?
    `
			)
			.run(name, this.owner, now + ttlMs, now, now, this.owner);
		return result.changes === 1;
	}

	release(name: string): void {
		this.database.sqlite.prepare("DELETE FROM worker_leases WHERE name = ? AND owner = ?").run(name, this.owner);
	}
}
