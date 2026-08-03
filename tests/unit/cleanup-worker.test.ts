import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/config/schema.js";
import { CleanupWorker } from "../../src/jobs/cleanup-worker.js";

describe("CleanupWorker", () => {
	it("does not acquire a lease or inspect members while cleanup is disabled", async () => {
		const leases = { acquire: vi.fn(), release: vi.fn() };
		const logger = { info: vi.fn(), error: vi.fn() };
		const worker = new CleanupWorker(
			{} as never,
			{ CLEANUP_ENABLED: false } as AppConfig,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			leases as never,
			{} as never,
			logger as never
		);

		worker.start();
		await worker.tick();

		expect(logger.info).toHaveBeenCalledWith("Automatic unregistered-member cleanup is disabled");
		expect(leases.acquire).not.toHaveBeenCalled();
	});
});
