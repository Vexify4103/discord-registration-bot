import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RiotAccountService } from "../../src/integrations/riot/riot-account-service.js";
import { RiotRequestQueue } from "../../src/queues/riot-request-queue.js";

describe("RiotAccountService", () => {
	afterEach(() => vi.unstubAllGlobals());
	const create = (retries = 0) => new RiotAccountService("key", new RiotRequestQueue(0), retries, pino({ level: "silent" }));
	it("returns canonical account data", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						puuid: "p",
						gameName: "Canonical",
						tagLine: "EUW",
					}),
					{ status: 200 }
				)
			)
		);
		await expect(create().byRiotId("europe", "Input", "EUW")).resolves.toEqual({
			kind: "success",
			account: { puuid: "p", gameName: "Canonical", tagLine: "EUW" },
		});
	});
	it.each([
		[404, "not-found"],
		[401, "authentication-failure"],
		[403, "authentication-failure"],
		[400, "invalid-request"],
	])("classifies HTTP %s", async (status, kind) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
		expect((await create().byRiotId("europe", "A", "B")).kind).toBe(kind);
	});
	it("honors 429 as temporary rate limiting", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "0" } })));
		await expect(create().byRiotId("europe", "A", "B")).resolves.toMatchObject({
			kind: "temporary-failure",
			code: "RIOT_RATE_LIMITED",
		});
	});
	it("classifies 5xx and network failures as temporary", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })));
		expect((await create().byPuuid("europe", "p")).kind).toBe("temporary-failure");
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
		expect((await create().byPuuid("europe", "p")).kind).toBe("temporary-failure");
	});
	it("keeps the authentication circuit open after a 401", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
		vi.stubGlobal("fetch", fetchMock);
		const queue = new RiotRequestQueue(0);
		const service = new RiotAccountService("key", queue, 0, pino({ level: "silent" }));
		await service.byRiotId("europe", "A", "B");
		await service.byRiotId("europe", "A", "B");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
