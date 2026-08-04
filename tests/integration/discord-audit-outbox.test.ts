import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseContext } from "../../src/database/client.js";
import { AuditRepository } from "../../src/repositories/audit-repository.js";
import { DiscordAuditOutboxRepository } from "../../src/repositories/discord-audit-outbox-repository.js";

describe("Discord audit outbox", () => {
	let directory: string;
	let context: DatabaseContext;
	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "discord-audit-outbox-test-"));
		context = createDatabase(join(directory, "test.sqlite"));
		migrate(context.db, { migrationsFolder: resolve("src/database/migrations") });
	});
	afterEach(() => {
		context.sqlite.close();
		if (directory.startsWith(tmpdir())) rmSync(directory, { recursive: true, force: true });
	});

	it("atomically queues only new publishable events when enabled", () => {
		const audits = new AuditRepository(context, true);
		const outbox = new DiscordAuditOutboxRepository(context);
		audits.create({ guildId: "guild", targetUserId: "user", action: "MEMBER_JOINED", result: "SUCCESS", now: 100 });
		expect(outbox.due(100)).toHaveLength(1);
		outbox.complete(outbox.due(100)[0]!.event.id);
		expect(outbox.due(100)).toHaveLength(0);
	});

	it("does not flood Discord with per-member migration classifications", () => {
		const audits = new AuditRepository(context, true);
		const outbox = new DiscordAuditOutboxRepository(context);
		audits.create({ guildId: "guild", targetUserId: "user", action: "MIGRATION_CLASSIFICATION", result: "UNKNOWN_FORMAT", now: 100 });
		expect(outbox.due(100)).toHaveLength(0);
	});

	it("keeps logging disabled when no webhook was configured", () => {
		new AuditRepository(context).create({ guildId: "guild", action: "MEMBER_LEFT", result: "SUCCESS", now: 100 });
		expect(new DiscordAuditOutboxRepository(context).due(100)).toHaveLength(0);
	});

	it("backs off retryable delivery failures", () => {
		const audits = new AuditRepository(context, true);
		const outbox = new DiscordAuditOutboxRepository(context);
		audits.create({ guildId: "guild", action: "MEMBER_LEFT", result: "SUCCESS", now: 100 });
		const id = outbox.due(100)[0]!.event.id;
		outbox.fail(id, "TEMPORARY", true, 100);
		expect(outbox.due(5_099)).toHaveLength(0);
		expect(outbox.due(5_100)[0]!.outbox.attemptCount).toBe(1);
	});
});
