import { AuditLogEvent, type GuildMember, type PartialGuildMember } from "discord.js";
import type { Logger } from "pino";
import type { AppConfig } from "../config/schema.js";
import type { AuditRepository } from "../repositories/audit-repository.js";
import type { RegistrationRepository } from "../repositories/registration-repository.js";
import type { AdministrativeNicknameParser } from "../parsers/administrative-nickname-parser.js";
import type { AdministrativeNicknameService } from "../services/administrative-nickname-service.js";
import type { NicknameService } from "../services/nickname-service.js";
import type { PermissionService } from "../services/permission-service.js";

interface HandlerOptions {
	auditLogDelayMs?: number;
	auditLogAttempts?: number;
}

export function createGuildMemberUpdateHandler(
	config: AppConfig,
	parser: AdministrativeNicknameParser,
	nicknameService: NicknameService,
	service: AdministrativeNicknameService,
	registrations: RegistrationRepository,
	permissions: PermissionService,
	audits: AuditRepository,
	logger: Logger,
	options: HandlerOptions = {}
) {
	const delayMs = options.auditLogDelayMs ?? 750;
	const attempts = options.auditLogAttempts ?? 3;
	return async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): Promise<void> => {
		if (newMember.guild.id !== config.DISCORD_GUILD_ID || newMember.user.bot || oldMember.nickname === newMember.nickname) return;
		const parsed = parser.parse(newMember.nickname);
		if (!parsed || isCurrentProjection(registrations, nicknameService, newMember)) return;
		try {
			const actor = await resolveNicknameActor(oldMember, newMember, delayMs, attempts);
			if (!actor || actor.id === newMember.client.user.id || (!permissions.isStaff(actor) && !permissions.isAdministrator(actor))) {
				registrations.requestReconciliation(newMember.guild.id, newMember.id);
				audits.create({
					guildId: newMember.guild.id,
					targetUserId: newMember.id,
					actorUserId: actor?.id ?? null,
					action: "ADMIN_NICKNAME_IMPORT",
					result: actor ? "UNAUTHORIZED" : "ACTOR_NOT_CONFIRMED",
				});
				return;
			}

			registrations.upsertJoined(newMember.guild.id, newMember.id, newMember.user.username, newMember.joinedTimestamp ?? Date.now());
			const result = await service.apply({
				guildId: newMember.guild.id,
				userId: newMember.id,
				actorUserId: actor.id,
				discordUsername: newMember.user.username,
				nickname: newMember.nickname!,
				parsed,
			});
			audits.create({
				guildId: newMember.guild.id,
				targetUserId: newMember.id,
				actorUserId: actor.id,
				action: "ADMIN_NICKNAME_IMPORT",
				result: result.kind === "success" ? "SUCCESS" : result.kind.toUpperCase().replaceAll("-", "_"),
				metadata: result.kind === "success" ? { status: result.status } : {},
			});
			if (result.kind !== "success") registrations.requestReconciliation(newMember.guild.id, newMember.id);
			logger.info({ guildId: newMember.guild.id, userId: newMember.id, actorUserId: actor.id, result: result.kind }, "Administrative nickname update processed");
		} catch (error) {
			logger.error({ err: error, guildId: newMember.guild.id, userId: newMember.id }, "Guild member nickname update processing failed");
		}
	};
}

async function resolveNicknameActor(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember, delayMs: number, attempts: number): Promise<GuildMember | undefined> {
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (delayMs > 0) await delay(delayMs);
		const logs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 10 });
		const entry = logs.entries.find(
			(value) =>
				value.targetId === newMember.id &&
				Date.now() - value.createdTimestamp <= 15_000 &&
				value.changes.some((change) => change.key === "nick" && (change.old ?? null) === oldMember.nickname && (change.new ?? null) === newMember.nickname)
		);
		if (entry?.executorId) return newMember.guild.members.fetch(entry.executorId).catch(() => undefined);
	}
	return undefined;
}

function isCurrentProjection(registrations: RegistrationRepository, nicknames: NicknameService, member: GuildMember): boolean {
	const row = registrations.get(member.guild.id, member.id);
	if (!row) return false;
	if (row.status === "REGISTERED")
		return member.nickname === nicknames.registered({ visibility: row.nameVisibility!, displayName: row.displayName, gameName: row.gameName!, tagLine: row.tagLine! });
	if (row.status === "VERIFIED_NO_RIOT") return member.nickname === nicknames.verifiedWithoutRiot(row.displayName!);
	if (row.status === "UNREGISTERED") return member.nickname === nicknames.unregistered(member.user.username);
	return false;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
