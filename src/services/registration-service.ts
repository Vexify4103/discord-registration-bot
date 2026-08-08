import type { Logger } from "pino";
import type { NameVisibility } from "../types/domain.js";
import { DuplicatePuuidError, RegistrationRepository } from "../repositories/mongo/registration-repository.js";
import { buildOpggUrl, OpggParser, parseRiotId, parseRiotPlatform, type ParsedOpggUrl } from "../parsers/opgg-parser.js";
import { RiotAccountService } from "../integrations/riot/riot-account-service.js";

export type RegistrationResult =
	| { kind: "success"; visibility: NameVisibility }
	| {
			kind:
				| "invalid-opgg"
				| "invalid-riot-id"
				| "invalid-platform"
				| "name-required"
				| "name-not-allowed"
				| "riot-not-found"
				| "riot-unavailable"
				| "duplicate-puuid";
	  };

interface CommonRegisterInput {
	guildId: string;
	userId: string;
	actorUserId: string;
	discordUsername: string;
	name?: string | null;
	hideName: boolean;
	overrideDuplicate?: boolean;
	overrideAuthorized?: boolean;
	priority?: number;
}

export interface RegisterInput extends CommonRegisterInput {
	opgg: string;
}

export interface RegisterRiotIdInput extends CommonRegisterInput {
	riotId: string;
	platform: string;
}

export class RegistrationService {
	constructor(
		private readonly registrations: RegistrationRepository,
		private readonly opgg: OpggParser,
		private readonly riot: RiotAccountService,
		private readonly logger: Logger
	) {}

	async register(input: RegisterInput): Promise<RegistrationResult> {
		const parsed = this.opgg.parse(input.opgg);
		if (!parsed) return { kind: "invalid-opgg" };
		return this.registerParsed(input, parsed);
	}

	async registerRiotId(input: RegisterRiotIdInput): Promise<RegistrationResult> {
		const identity = parseRiotId(input.riotId);
		if (!identity) return { kind: "invalid-riot-id" };
		const platform = parseRiotPlatform(input.platform);
		if (!platform) return { kind: "invalid-platform" };
		return this.registerParsed(input, {
			...identity,
			...platform,
			normalizedUrl: buildOpggUrl(platform.platformRegion, identity.gameName, identity.tagLine),
		});
	}

	private async registerParsed(input: CommonRegisterInput, parsed: ParsedOpggUrl): Promise<RegistrationResult> {
		const visibility: NameVisibility = input.hideName ? "HIDDEN" : "VISIBLE";
		const name = input.name?.trim() || null;
		if (visibility === "VISIBLE" && !name) return { kind: "name-required" };
		if (visibility === "HIDDEN" && name) return { kind: "name-not-allowed" };
		if (input.overrideDuplicate && input.overrideAuthorized) {
			const source = await this.registrations.findRegisteredByRiotId(input.guildId, `${parsed.gameName}#${parsed.tagLine}`, input.userId);
			if (source?.puuid && source.gameName && source.tagLine && source.riotId && source.platformRegion && source.accountRoutingGroup && source.opggUrl) {
				await this.registrations.saveRegistered({
					guildId: input.guildId,
					userId: input.userId,
					actorUserId: input.actorUserId,
					discordUsername: input.discordUsername,
					displayName: visibility === "VISIBLE" ? name : null,
					nameVisibility: visibility,
					identity: {
						puuid: source.puuid,
						gameName: source.gameName,
						tagLine: source.tagLine,
						riotId: source.riotId,
						platformRegion: source.platformRegion,
						accountRoutingGroup: source.accountRoutingGroup,
						opggUrl: source.opggUrl,
					},
					overrideDuplicate: true,
					overrideAuthorized: true,
					...(input.priority == null ? {} : { priority: input.priority }),
				});
				return { kind: "success", visibility };
			}
		}
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
					guildId: input.guildId,
					userId: input.userId,
					actorUserId: input.actorUserId,
					discordUsername: input.discordUsername,
					displayName: visibility === "VISIBLE" ? name : null,
					nameVisibility: visibility,
					identity,
					...(input.overrideDuplicate == null ? {} : { overrideDuplicate: input.overrideDuplicate }),
					...(input.overrideAuthorized == null ? {} : { overrideAuthorized: input.overrideAuthorized }),
					...(input.priority == null ? {} : { priority: input.priority }),
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
