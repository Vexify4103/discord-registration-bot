import type { Registration } from "../database/schema/index.js";
import type { DiscordOperationType, RankedTier, RankRoleIds, RankRoleKey, RoleIds } from "../types/domain.js";
import { NicknameService } from "./nickname-service.js";

export interface MemberSnapshot {
	userId: string;
	username: string;
	nickname: string | null;
	roleIds: ReadonlySet<string>;
	manageable: boolean;
}
export interface PlannedDiscordOperation {
	type: DiscordOperationType;
	value?: string;
}
export interface ReconciliationPlan {
	manageable: boolean;
	preserve: boolean;
	expectedNickname: string | null;
	operations: PlannedDiscordOperation[];
}

export class MemberStateReconciler {
	constructor(
		private readonly roles: RoleIds,
		private readonly nicknames: NicknameService,
		private readonly rankRoles: RankRoleIds = {}
	) {}

	plan(registration: Registration, member: MemberSnapshot, effectiveTier: RankedTier | null | undefined = undefined): ReconciliationPlan {
		if (!member.manageable)
			return {
				manageable: false,
				preserve: true,
				expectedNickname: null,
				operations: [],
			};
		if (registration.status === "PENDING_VERIFICATION")
			return {
				manageable: true,
				preserve: true,
				expectedNickname: member.nickname,
				operations: [],
			};
		const operations: PlannedDiscordOperation[] = [];
		let expectedNickname: string;
		if (registration.status === "REGISTERED") {
			if (!registration.nameVisibility || !registration.gameName || !registration.tagLine) throw new Error("INVALID_REGISTERED_STATE");
			expectedNickname = this.nicknames.registered({
				visibility: registration.nameVisibility,
				displayName: registration.displayName,
				gameName: registration.gameName,
				tagLine: registration.tagLine,
			});
			const desired = registration.nameVisibility === "VISIBLE" ? this.roles.named : this.roles.private;
			const wrong = registration.nameVisibility === "VISIBLE" ? this.roles.private : this.roles.named;
			if (member.roleIds.has(wrong))
				operations.push({
					type: registration.nameVisibility === "VISIBLE" ? "REMOVE_VERIFIED_PRIVATE_ROLE" : "REMOVE_VERIFIED_NAMED_ROLE",
				});
			if (!member.roleIds.has(desired))
				operations.push({
					type: registration.nameVisibility === "VISIBLE" ? "ADD_VERIFIED_NAMED_ROLE" : "ADD_VERIFIED_PRIVATE_ROLE",
				});
			if (member.roleIds.has(this.roles.unregistered)) operations.push({ type: "REMOVE_UNREGISTERED_ROLE" });
		} else if (registration.status === "VERIFIED_NO_RIOT") {
			if (!registration.displayName?.trim() || registration.nameVisibility !== "VISIBLE") throw new Error("INVALID_VERIFIED_NO_RIOT_STATE");
			expectedNickname = this.nicknames.verifiedWithoutRiot(registration.displayName);
			if (member.roleIds.has(this.roles.private)) operations.push({ type: "REMOVE_VERIFIED_PRIVATE_ROLE" });
			if (!member.roleIds.has(this.roles.named)) operations.push({ type: "ADD_VERIFIED_NAMED_ROLE" });
			if (member.roleIds.has(this.roles.unregistered)) operations.push({ type: "REMOVE_UNREGISTERED_ROLE" });
		} else {
			expectedNickname = this.nicknames.unregistered(member.username);
			if (member.roleIds.has(this.roles.named)) operations.push({ type: "REMOVE_VERIFIED_NAMED_ROLE" });
			if (member.roleIds.has(this.roles.private)) operations.push({ type: "REMOVE_VERIFIED_PRIVATE_ROLE" });
			if (!member.roleIds.has(this.roles.unregistered)) operations.push({ type: "ADD_UNREGISTERED_ROLE" });
		}
		if (member.nickname !== expectedNickname) operations.push({ type: "SET_NICKNAME", value: expectedNickname });
		this.planRankRoles(registration, member, effectiveTier, operations);
		return { manageable: true, preserve: false, expectedNickname, operations };
	}

	private planRankRoles(registration: Registration, member: MemberSnapshot, effectiveTier: RankedTier | null | undefined, operations: PlannedDiscordOperation[]): void {
		const configured = Object.entries(this.rankRoles) as Array<[RankRoleKey, string]>;
		if (!configured.length) return;
		if (registration.status === "REGISTERED" && effectiveTier === undefined) return;
		const desired = registration.status === "REGISTERED" && effectiveTier !== undefined ? this.rankRoles[effectiveTier ?? "UNRANKED"] : undefined;
		for (const [, roleId] of configured) if (roleId !== desired && member.roleIds.has(roleId)) operations.push({ type: "REMOVE_RANK_ROLE", value: roleId });
		if (desired && !member.roleIds.has(desired)) operations.push({ type: "ADD_RANK_ROLE", value: desired });
	}
}
