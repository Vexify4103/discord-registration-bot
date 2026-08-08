import type { Logger } from "pino";
import type { AppConfig } from "../config/schema.js";
import type { AdministrativeNickname } from "../parsers/administrative-nickname-parser.js";
import { buildOpggUrl } from "../parsers/opgg-parser.js";
import { DuplicatePuuidError, RegistrationRepository } from "../repositories/mongo/registration-repository.js";
import { RiotAccountService } from "../integrations/riot/riot-account-service.js";

export type AdministrativeNicknameResult =
	{ kind: "success"; status: "REGISTERED" | "VERIFIED_NO_RIOT" } | { kind: "duplicate-puuid" | "hidden-riot-not-found" | "riot-unavailable" };

export interface AdministrativeNicknameInput {
	guildId: string;
	userId: string;
	actorUserId: string;
	discordUsername: string;
	nickname: string;
	parsed: AdministrativeNickname;
	allowDuplicate?: boolean;
}

export class AdministrativeNicknameService {
	constructor(
		private readonly config: AppConfig,
		private readonly registrations: RegistrationRepository,
		private readonly riot: RiotAccountService,
		private readonly logger: Logger
	) {}

	async apply(input: AdministrativeNicknameInput): Promise<AdministrativeNicknameResult> {
		if (input.parsed.kind === "VERIFIED_NO_RIOT") {
			await this.saveWithoutRiot(input, "ADMIN_NICKNAME");
			return { kind: "success", status: "VERIFIED_NO_RIOT" };
		}
		if (input.allowDuplicate) {
			const source = await this.registrations.findRegisteredByRiotId(
				input.guildId,
				`${input.parsed.gameName}#${input.parsed.tagLine}`,
				input.userId
			);
			if (source?.puuid && source.gameName && source.tagLine && source.riotId && source.platformRegion && source.accountRoutingGroup && source.opggUrl) {
				await this.registrations.saveRegistered({
					guildId: input.guildId,
					userId: input.userId,
					actorUserId: input.actorUserId,
					discordUsername: input.discordUsername,
					displayName: input.parsed.displayName,
					nameVisibility: input.parsed.visibility,
					identity: {
						puuid: source.puuid,
						gameName: source.gameName,
						tagLine: source.tagLine,
						riotId: source.riotId,
						platformRegion: source.platformRegion,
						accountRoutingGroup: source.accountRoutingGroup,
						opggUrl: source.opggUrl,
					},
					priority: 60,
					overrideDuplicate: true,
					overrideAuthorized: true,
				});
				return { kind: "success", status: "REGISTERED" };
			}
		}

		const attemptId = await this.registrations.createAttempt(input.guildId, input.userId, input.actorUserId);
		try {
			const result = await this.riot.byRiotId(this.config.DEFAULT_RIOT_ACCOUNT_ROUTE, input.parsed.gameName, input.parsed.tagLine, 60);
			if (result.kind === "not-found" || result.kind === "invalid-request") {
				if (input.parsed.visibility === "VISIBLE") {
					await this.saveWithoutRiot(input, "ADMIN_RIOT_NOT_FOUND");
					return { kind: "success", status: "VERIFIED_NO_RIOT" };
				}
				return { kind: "hidden-riot-not-found" };
			}
			if (result.kind !== "success") return { kind: "riot-unavailable" };
			try {
				await this.registrations.saveRegistered({
					guildId: input.guildId,
					userId: input.userId,
					actorUserId: input.actorUserId,
					discordUsername: input.discordUsername,
					displayName: input.parsed.displayName,
					nameVisibility: input.parsed.visibility,
					identity: {
						...result.account,
						riotId: `${result.account.gameName}#${result.account.tagLine}`,
						platformRegion: this.config.DEFAULT_RIOT_PLATFORM_REGION,
						accountRoutingGroup: this.config.DEFAULT_RIOT_ACCOUNT_ROUTE,
						opggUrl: buildOpggUrl(this.config.DEFAULT_RIOT_PLATFORM_REGION, result.account.gameName, result.account.tagLine),
					},
					priority: 60,
					overrideDuplicate: input.allowDuplicate ?? false,
					overrideAuthorized: input.allowDuplicate ?? false,
				});
			} catch (error) {
				if (error instanceof DuplicatePuuidError) return { kind: "duplicate-puuid" };
				throw error;
			}
			return { kind: "success", status: "REGISTERED" };
		} catch (error) {
			this.logger.error({ err: error, guildId: input.guildId, userId: input.userId }, "Administrative nickname registration failed");
			return { kind: "riot-unavailable" };
		} finally {
			await this.registrations.removeAttempt(attemptId);
		}
	}

	private async saveWithoutRiot(input: AdministrativeNicknameInput, reason: "ADMIN_NICKNAME" | "ADMIN_RIOT_NOT_FOUND"): Promise<void> {
		const displayName = input.parsed.kind === "VERIFIED_NO_RIOT" ? input.parsed.displayName : input.parsed.displayName!;
		await this.registrations.saveVerifiedWithoutRiot({
			guildId: input.guildId,
			userId: input.userId,
			actorUserId: input.actorUserId,
			discordUsername: input.discordUsername,
			displayName,
			reason,
			priority: 60,
		});
	}
}
