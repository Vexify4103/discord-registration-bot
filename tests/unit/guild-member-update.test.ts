import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/config/schema.js";
import { createGuildMemberUpdateHandler } from "../../src/events/guild-member-update.js";
import { AdministrativeNicknameParser } from "../../src/parsers/administrative-nickname-parser.js";

describe("guild member nickname updates", () => {
	it("imports a recognized nickname changed by authorized staff", async () => {
		const actor = { id: "admin-1" };
		const { oldMember, newMember, fetchAuditLogs } = members(actor);
		const service = { apply: vi.fn().mockResolvedValue({ kind: "success", status: "REGISTERED" }) };
		const registrations = {
			get: vi.fn().mockReturnValue(undefined),
			upsertJoined: vi.fn(),
			requestReconciliation: vi.fn(),
		};
		const handler = createGuildMemberUpdateHandler(
			{ DISCORD_GUILD_ID: "guild-1" } as AppConfig,
			new AdministrativeNicknameParser(),
			{} as never,
			service as never,
			registrations as never,
			{ isStaff: vi.fn().mockReturnValue(true), isAdministrator: vi.fn().mockReturnValue(false) } as never,
			{ create: vi.fn() } as never,
			{ info: vi.fn(), error: vi.fn() } as never,
			{ auditLogDelayMs: 0, auditLogAttempts: 1 }
		);

		await handler(oldMember as never, newMember as never);

		expect(fetchAuditLogs).toHaveBeenCalledOnce();
		expect(service.apply).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: actor.id,
				parsed: expect.objectContaining({ kind: "REGISTERED", visibility: "VISIBLE", displayName: "Martin" }),
			})
		);
		expect(registrations.requestReconciliation).not.toHaveBeenCalled();
	});

	it("does not import a recognized nickname changed by an unauthorized member", async () => {
		const { oldMember, newMember } = members({ id: "ordinary-user" });
		const service = { apply: vi.fn() };
		const registrations = { get: vi.fn(), upsertJoined: vi.fn(), requestReconciliation: vi.fn() };
		const handler = createGuildMemberUpdateHandler(
			{ DISCORD_GUILD_ID: "guild-1" } as AppConfig,
			new AdministrativeNicknameParser(),
			{} as never,
			service as never,
			registrations as never,
			{ isStaff: vi.fn().mockReturnValue(false), isAdministrator: vi.fn().mockReturnValue(false) } as never,
			{ create: vi.fn() } as never,
			{ info: vi.fn(), error: vi.fn() } as never,
			{ auditLogDelayMs: 0, auditLogAttempts: 1 }
		);

		await handler(oldMember as never, newMember as never);

		expect(service.apply).not.toHaveBeenCalled();
		expect(registrations.requestReconciliation).toHaveBeenCalledWith("guild-1", "member-1");
	});

	it("ignores the bot's own projection without fetching audit logs", async () => {
		const { oldMember, newMember, fetchAuditLogs } = members({ id: "bot-1" });
		const registrations = {
			get: vi.fn().mockReturnValue({ status: "VERIFIED_NO_RIOT", displayName: "Martin" }),
		};
		const service = { apply: vi.fn() };
		const handler = createGuildMemberUpdateHandler(
			{ DISCORD_GUILD_ID: "guild-1" } as AppConfig,
			new AdministrativeNicknameParser(),
			{ verifiedWithoutRiot: vi.fn().mockReturnValue("Martin | Player#EUW") } as never,
			service as never,
			registrations as never,
			{} as never,
			{} as never,
			{} as never,
			{ auditLogDelayMs: 0, auditLogAttempts: 1 }
		);

		await handler(oldMember as never, newMember as never);

		expect(fetchAuditLogs).not.toHaveBeenCalled();
		expect(service.apply).not.toHaveBeenCalled();
	});
});

function members(actor: { id: string }) {
	const fetchAuditLogs = vi.fn().mockResolvedValue({
		entries: [
			{
				targetId: "member-1",
				executorId: actor.id,
				createdTimestamp: Date.now(),
				changes: [{ key: "nick", old: "Old nickname", new: "Martin | Player#EUW" }],
			},
		],
	});
	const guild = {
		id: "guild-1",
		fetchAuditLogs,
		members: { fetch: vi.fn().mockResolvedValue(actor) },
	};
	return {
		fetchAuditLogs,
		oldMember: { nickname: "Old nickname" },
		newMember: {
			id: "member-1",
			nickname: "Martin | Player#EUW",
			guild,
			user: { bot: false, username: "discord-user" },
			client: { user: { id: "bot-1" } },
			joinedTimestamp: 1_700_000_000_000,
		},
	};
}
