import { describe, expect, it, vi } from "vitest";
import { OpggParser } from "../../src/parsers/opgg-parser.js";
import { RegistrationService } from "../../src/services/registration-service.js";

const base = {
	guildId: "guild-1",
	userId: "user-2",
	actorUserId: "admin-1",
	discordUsername: "second-account",
	name: "Alex",
	hideName: false,
	riotId: "RUS Yasuicide#777",
	platform: "EUW",
	overrideDuplicate: true,
	overrideAuthorized: true,
};

describe("RegistrationService Riot-ID registration", () => {
	it("registers a second Discord account from a Riot ID without requiring OP.GG", async () => {
		const repository = repositoryMock();
		const service = new RegistrationService(
			repository as never,
			new OpggParser(),
			{ byRiotId: vi.fn().mockResolvedValue({ kind: "success", account: { puuid: "shared-puuid", gameName: "RUS Yasuicide", tagLine: "777" } }) } as never,
			{ error: vi.fn() } as never
		);

		expect(await service.registerRiotId(base)).toEqual({ kind: "success", visibility: "VISIBLE" });
		expect(repository.saveRegistered).toHaveBeenCalledWith(
			expect.objectContaining({
				displayName: "Alex",
				overrideDuplicate: true,
				overrideAuthorized: true,
				identity: expect.objectContaining({ platformRegion: "EUW1", riotId: "RUS Yasuicide#777" }),
			})
		);
	});

	it("rejects an unknown platform before calling Riot", async () => {
		const repository = repositoryMock();
		const byRiotId = vi.fn();
		const service = new RegistrationService(repository as never, new OpggParser(), { byRiotId } as never, { error: vi.fn() } as never);

		expect(await service.registerRiotId({ ...base, platform: "UNKNOWN" })).toEqual({ kind: "invalid-platform" });
		expect(byRiotId).not.toHaveBeenCalled();
	});
});

function repositoryMock() {
	return {
		findRegisteredByRiotId: vi.fn().mockResolvedValue(undefined),
		createAttempt: vi.fn().mockResolvedValue("attempt-1"),
		removeAttempt: vi.fn().mockResolvedValue(undefined),
		saveRegistered: vi.fn().mockResolvedValue(undefined),
	};
}
