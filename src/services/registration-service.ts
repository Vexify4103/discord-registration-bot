import type { Logger } from "pino";
import type { NameVisibility } from "../types/domain.js";
import { DuplicatePuuidError, RegistrationRepository } from "../repositories/mongo/registration-repository.js";
import { buildOpggUrl, OpggParser } from "../parsers/opgg-parser.js";
import { RiotAccountService } from "../integrations/riot/riot-account-service.js";

export type RegistrationResult =
	| { kind: "success"; visibility: NameVisibility }
	| {
			kind: "invalid-opgg" | "name-required" | "name-not-allowed" | "riot-not-found" | "riot-unavailable" | "duplicate-puuid";
	  };

export interface RegisterInput {
	guildId: string;
	userId: string;
	actorUserId: string;
	discordUsername: string;
	name?: string | null;
	hideName: boolean;
	opgg: string;
	overrideDuplicate?: boolean;
	overrideAuthorized?: boolean;
}

export class RegistrationService {
	constructor(
		private readonly registrations: RegistrationRepository,
		private readonly opgg: OpggParser,
		private readonly riot: RiotAccountService,
		private readonly logger: Logger
	) {}

	async register(input: RegisterInput): Promise<RegistrationResult> {
		const visibility: NameVisibility = input.hideName ? "HIDDEN" : "VISIBLE";
		const name = input.name?.trim() || null;
		if (visibility === "VISIBLE" && !name) return { kind: "name-required" };
		if (visibility === "HIDDEN" && name) return { kind: "name-not-allowed" };
		const parsed = this.opgg.parse(input.opgg);
		if (!parsed) return { kind: "invalid-opgg" };
		const attemptId = await this.registrations.createAttempt(input.guildId, input.userId, input.actorUserId);
		try {
			const result = await this.riot.byRiotId(parsed.accountRoutingGroup, parsed.gameName, parsed.tagLine);
			if (result.kind === "not-found" || result.kind === "invalid-request") return { kind: "riot-not-found" };
			if (result.kind !== "success") return { kind: "riot-unavailable" };
			const identity = {
				...result.account,
				riotId: `${result.account.gameName}#${result.account.tagLine}`,
				platformRegion: parsed.platformRegion,
				accountRoutingGroup: parsed.accountRoutingGroup,
				opggUrl: buildOpggUrl(parsed.platformRegion, result.account.gameName, result.account.tagLine),
			};
			try {
				await this.registrations.saveRegistered({
					...input,
					displayName: visibility === "VISIBLE" ? name : null,
					nameVisibility: visibility,
					identity,
				});
			} catch (error) {
				if (error instanceof DuplicatePuuidError) return { kind: "duplicate-puuid" };
				throw error;
			}
			return { kind: "success", visibility };
		} catch (error) {
			this.logger.error({ err: error, guildId: input.guildId, userId: input.userId }, "Registration failed");
			return { kind: "riot-unavailable" };
		} finally {
			await this.registrations.removeAttempt(attemptId);
		}
	}
}
