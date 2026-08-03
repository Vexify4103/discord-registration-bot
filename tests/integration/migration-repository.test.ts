import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "../../src/database/client.js";
import { MigrationRepository, type PreviewItem } from "../../src/repositories/migration-repository.js";

describe("MigrationRepository review runs", () => {
	let directory: string;
	let context: DatabaseContext;
	let repository: MigrationRepository;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "migration-review-test-"));
		context = createDatabase(join(directory, "test.sqlite"));
		migrate(context.db, { migrationsFolder: resolve("src/database/migrations") });
		repository = new MigrationRepository(context);
	});

	afterEach(() => {
		context.sqlite.close();
		if (directory.startsWith(tmpdir())) rmSync(directory, { recursive: true, force: true });
	});

	const previewItem = (userId: string): PreviewItem => ({
		guildId: "guild-1",
		userId,
		username: `discord-${userId}`,
		nickname: null,
		parsed: {
			category: "UNKNOWN_FORMAT",
			originalNickname: null,
			displayName: null,
			gameName: null,
			tagLine: null,
			nameVisibility: null,
		},
		manageable: true,
		fingerprint: `fingerprint-${userId}`,
		estimatedOperations: [],
	});

	it("starts a targeted review and retires the source candidates atomically", () => {
		const source = repository.createPreview("guild-1", "admin-1", "{}", "source", [previewItem("user-1")], 10);
		repository.completeItem(repository.items(source.id)[0]!, "MANUAL_REVIEW", "MANUAL_REVIEW");
		const target = repository.createPreview("guild-1", "admin-1", "{}", "target", [previewItem("user-1")], 20);

		repository.startReview(target.id, source.id, ["user-1"]);

		expect(repository.getJob(target.id)?.status).toBe("RUNNING");
		expect(repository.items(source.id)[0]?.state).toBe("REQUEUED_FOR_REVIEW");
	});

	it("rolls back the target start if retiring source candidates fails", () => {
		const source = repository.createPreview("guild-1", "admin-1", "{}", "source", [previewItem("user-1")], 10);
		repository.completeItem(repository.items(source.id)[0]!, "MANUAL_REVIEW", "MANUAL_REVIEW");
		const target = repository.createPreview("guild-1", "admin-1", "{}", "target", [previewItem("user-1")], 20);
		vi.spyOn(repository, "markReviewCandidatesRequeued").mockImplementation(() => {
			throw new Error("test rollback");
		});

		expect(() => repository.startReview(target.id, source.id, ["user-1"])).toThrow("test rollback");
		expect(repository.getJob(target.id)?.status).toBe("PREVIEWED");
		expect(repository.items(source.id)[0]?.state).toBe("MANUAL_REVIEW");
	});
});
