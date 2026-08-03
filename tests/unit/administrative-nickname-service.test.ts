import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/config/schema.js";
import { AdministrativeNicknameService } from "../../src/services/administrative-nickname-service.js";

const config = { DEFAULT_RIOT_ACCOUNT_ROUTE: "europe", DEFAULT_RIOT_PLATFORM_REGION: "EUW1" } as AppConfig;
const base = {
	guildId: "guild-1",
	userId: "user-1",
	actorUserId: "admin-1",
	discordUsername: "discord-user",
	nickname: "Martin | Player#EUW",
};

describe("AdministrativeNicknameService", () => {
	it("stores a canonical visible registration", async () => {
		const registrations = repositoryMock();
		const service = new AdministrativeNicknameService(
			config,
			registrations as never,
			{ byRiotId: vi.fn().mockResolvedValue({ kind: "success", account: { puuid: "puuid", gameName: "Canonical", tagLine: "EUW" } }) } as never,
			{ error: vi.fn() } as never
		);
		const result = await service.apply({
			...base,
			parsed: { kind: "REGISTERED", visibility: "VISIBLE", displayName: "Martin", gameName: "Player", tagLine: "EUW" },
		});

		expect(result).toEqual({ kind: "success", status: "REGISTERED" });
		expect(registrations.saveRegistered).toHaveBeenCalledWith(
			expect.objectContaining({
				displayName: "Martin",
				nameVisibility: "VISIBLE",
				identity: expect.objectContaining({ puuid: "puuid", riotId: "Canonical#EUW" }),
			})
		);
	});

	it("stores hidden registrations without a display name", async () => {
		const registrations = repositoryMock();
		const service = new AdministrativeNicknameService(
			config,
			registrations as never,
			{ byRiotId: vi.fn().mockResolvedValue({ kind: "success", account: { puuid: "puuid", gameName: "Player", tagLine: "EUW" } }) } as never,
			{ error: vi.fn() } as never
		);
		await service.apply({
			...base,
			parsed: { kind: "REGISTERED", visibility: "HIDDEN", displayName: null, gameName: "Player", tagLine: "EUW" },
		});
		expect(registrations.saveRegistered).toHaveBeenCalledWith(expect.objectContaining({ displayName: null, nameVisibility: "HIDDEN" }));
	});

	it("normalizes a missing visible Riot account to verified without Riot", async () => {
		const registrations = repositoryMock();
		const service = new AdministrativeNicknameService(
			config,
			registrations as never,
			{ byRiotId: vi.fn().mockResolvedValue({ kind: "not-found" }) } as never,
			{ error: vi.fn() } as never
		);
		const result = await service.apply({
			...base,
			parsed: { kind: "REGISTERED", visibility: "VISIBLE", displayName: "Martin", gameName: "Missing", tagLine: "EUW" },
		});
		expect(result).toEqual({ kind: "success", status: "VERIFIED_NO_RIOT" });
		expect(registrations.saveVerifiedWithoutRiot).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Martin", reason: "ADMIN_RIOT_NOT_FOUND" }));
	});
});

function repositoryMock() {
	return {
		createAttempt: vi.fn().mockReturnValue("attempt-1"),
		removeAttempt: vi.fn(),
		saveRegistered: vi.fn(),
		saveVerifiedWithoutRiot: vi.fn(),
	};
}
