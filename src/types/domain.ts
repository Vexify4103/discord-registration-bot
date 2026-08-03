export const registrationStatuses = ["UNREGISTERED", "PENDING_VERIFICATION", "REGISTERED"] as const;
export type RegistrationStatus = (typeof registrationStatuses)[number];

export const nameVisibilities = ["VISIBLE", "HIDDEN"] as const;
export type NameVisibility = (typeof nameVisibilities)[number];

export const syncStatuses = ["NOT_REQUIRED", "PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED_RETRYABLE", "FAILED_PERMANENT"] as const;
export type SyncStatus = (typeof syncStatuses)[number];

export const legacyCategories = [
	"LEGACY_REGISTERED_VISIBLE_NAME",
	"LEGACY_REGISTERED_HIDDEN_NAME",
	"LEGACY_UNREGISTERED",
	"UNKNOWN_FORMAT",
	"UNMANAGEABLE",
	"EXEMPT",
	"PENDING_RIOT_VERIFICATION",
] as const;
export type LegacyCategory = (typeof legacyCategories)[number];

export const discordOperationTypes = [
	"SET_NICKNAME",
	"ADD_VERIFIED_NAMED_ROLE",
	"REMOVE_VERIFIED_NAMED_ROLE",
	"ADD_VERIFIED_PRIVATE_ROLE",
	"REMOVE_VERIFIED_PRIVATE_ROLE",
	"ADD_UNREGISTERED_ROLE",
	"REMOVE_UNREGISTERED_ROLE",
	"KICK_MEMBER",
	"SEND_DM",
] as const;
export type DiscordOperationType = (typeof discordOperationTypes)[number];

export const operationPriorities = {
	INTERACTION: 100,
	REGISTRATION: 90,
	JOIN: 80,
	CLEANUP: 70,
	STAFF: 60,
	MIGRATION: 50,
	RIOT_SYNC: 40,
	REPAIR: 30,
} as const;

export interface CanonicalRiotAccount {
	puuid: string;
	gameName: string;
	tagLine: string;
}

export interface RegistrationIdentity extends CanonicalRiotAccount {
	riotId: string;
	platformRegion: string;
	accountRoutingGroup: string;
	opggUrl: string;
}

export interface RoleIds {
	named: string;
	private: string;
	unregistered: string;
}
