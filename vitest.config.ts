import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// The production target is a low-memory Raspberry Pi. Running several
		// better-sqlite3 migration fixtures concurrently causes swap and SD-card
		// contention, which can make otherwise fast beforeEach hooks time out.
		fileParallelism: false,
		hookTimeout: 30_000,
		coverage: { reporter: ["text", "html"] },
		testTimeout: 10_000,
	},
});
