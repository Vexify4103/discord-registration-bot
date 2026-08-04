import { Collection, type GuildMember } from "discord.js";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { Registration } from "../../src/database/schema/index.js";
import type { RegistrationRepository } from "../../src/repositories/registration-repository.js";
import { RankRoleStartupSweep } from "../../src/services/rank-role-startup-sweep.js";

function member(id: string, bot = false): GuildMember {
	return { id, user: { bot, username: `user-${id}` }, joinedTimestamp: 1 } as GuildMember;
}
function registration(userId: string, status: Registration["status"], puuid: string | null = null): Registration {
	return { userId, status, puuid, isPresent: true } as Registration;
}

describe("RankRoleStartupSweep", () => {
	it("queues registered and cleanup states while preserving pending members and bots", async () => {
		const rows = new Map<string, Registration>([
			["registered", registration("registered", "REGISTERED", "puuid")],
			["no-riot", registration("no-riot", "VERIFIED_NO_RIOT")],
			["unregistered", registration("unregistered", "UNREGISTERED")],
			["pending", registration("pending", "PENDING_VERIFICATION")],
		]);
		const requestReconciliation = vi.fn((_guildId: string, _userId: string, _priority?: number) => true);
		const repository = {
			get: vi.fn((_guildId: string, userId: string) => rows.get(userId)),
			upsertJoined: vi.fn((_guildId: string, userId: string) => registration(userId, "UNREGISTERED")),
			requestReconciliation,
		} as unknown as RegistrationRepository;
		const members = new Collection<string, GuildMember>([
			["registered", member("registered")],
			["no-riot", member("no-riot")],
			["unregistered", member("unregistered")],
			["pending", member("pending")],
			["missing", member("missing")],
			["bot", member("bot", true)],
		]);
		const summary = await new RankRoleStartupSweep(repository, pino({ level: "silent" })).run("guild", members);
		expect(summary).toEqual({ totalMembers: 6, botsIgnored: 1, registeredQueued: 1, cleanupQueued: 3, pendingPreserved: 1 });
		expect(requestReconciliation.mock.calls.map((call) => call[1])).toEqual(["registered", "no-riot", "unregistered", "missing"]);
	});
});
