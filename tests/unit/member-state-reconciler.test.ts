import { describe, expect, it } from "vitest";
import type { Registration } from "../../src/database/schema/index.js";
import { MemberStateReconciler } from "../../src/services/member-state-reconciler.js";
import { NicknameService } from "../../src/services/nickname-service.js";

const base = {
	guildId: "1",
	userId: "2",
	discordUsernameSnapshot: "discord",
	status: "REGISTERED",
	isPresent: true,
	joinedAt: 1,
	leftAt: null,
	retentionExpiresAt: null,
	unregisteredSince: null,
	displayName: "Martin",
	nameVisibility: "VISIBLE",
	puuid: "p",
	gameName: "Game",
	tagLine: "EUW",
	riotId: "Game#EUW",
	platformRegion: "EUW1",
	accountRoutingGroup: "europe",
	opggUrl: "x",
	registeredAt: 1,
	lastRiotSyncAt: null,
	nextRiotSyncAt: 1,
	riotSyncStatus: "PENDING",
	riotSyncFailureCount: 0,
	lastRiotSyncErrorCode: null,
	lastNicknameSyncAt: null,
	nicknameSyncStatus: "PENDING",
	lastRoleSyncAt: null,
	roleSyncStatus: "PENDING",
	migrationSource: null,
	originalMigrationNickname: null,
	migrationJobId: null,
	stateVersion: 1,
	duplicatePuuidOverride: false,
	duplicateOverrideActorId: null,
	duplicateOverrideAt: null,
	lastFailureCode: null,
	lastFailureAt: null,
	cleanupClaimVersion: null,
	createdAt: 1,
	updatedAt: 1,
} as Registration;
const service = new MemberStateReconciler({ named: "named", private: "private", unregistered: "unreg" }, new NicknameService());

describe("MemberStateReconciler", () => {
	it("visible member receives only named role and repairs both-role state", () =>
		expect(
			service
				.plan(base, {
					userId: "2",
					username: "d",
					nickname: null,
					roleIds: new Set(["private"]),
					manageable: true,
				})
				.operations.map((x) => x.type)
		).toEqual(["REMOVE_VERIFIED_PRIVATE_ROLE", "ADD_VERIFIED_NAMED_ROLE", "SET_NICKNAME"]));
	it("hidden member receives only private role", () =>
		expect(
			service
				.plan(
					{ ...base, nameVisibility: "HIDDEN", displayName: null },
					{
						userId: "2",
						username: "d",
						nickname: "? | Game#EUW",
						roleIds: new Set(["named"]),
						manageable: true,
					}
				)
				.operations.map((x) => x.type)
		).toEqual(["REMOVE_VERIFIED_NAMED_ROLE", "ADD_VERIFIED_PRIVATE_ROLE"]));
	it("pending member is preserved", () =>
		expect(
			service.plan(
				{ ...base, status: "PENDING_VERIFICATION" },
				{
					userId: "2",
					username: "d",
					nickname: "old",
					roleIds: new Set(["named"]),
					manageable: true,
				}
			).operations
		).toEqual([]));
	it("verified member without Riot keeps the known name and receives only the named role", () =>
		expect(
			service
				.plan(
					{
						...base,
						status: "VERIFIED_NO_RIOT",
						puuid: null,
						gameName: null,
						tagLine: null,
						riotId: null,
						platformRegion: null,
						accountRoutingGroup: null,
						opggUrl: null,
						nextRiotSyncAt: null,
						riotSyncStatus: "NOT_REQUIRED",
					},
					{
						userId: "2",
						username: "d",
						nickname: "Martin | ?#?",
						roleIds: new Set(["private", "unreg"]),
						manageable: true,
					}
				)
				.operations.map((operation) => operation.type)
		).toEqual(["REMOVE_VERIFIED_PRIVATE_ROLE", "ADD_VERIFIED_NAMED_ROLE", "REMOVE_UNREGISTERED_ROLE"]));
	it("higher staff role does not alter desired registration roles when member remains manageable", () =>
		expect(
			service.plan(base, {
				userId: "2",
				username: "d",
				nickname: "Martin | Game#EUW",
				roleIds: new Set(["staff", "named"]),
				manageable: true,
			}).operations
		).toEqual([]));
});
