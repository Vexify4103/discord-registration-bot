import { createHash, randomBytes } from "node:crypto";
import type { Guild, GuildMember } from "discord.js";
import type { AppConfig } from "../config/schema.js";
import { LegacyNicknameParser, type LegacyParseResult } from "../parsers/legacy-nickname-parser.js";
import { MigrationRepository } from "../repositories/migration-repository.js";
import { PermissionService } from "./permission-service.js";
import { AuditRepository } from "../repositories/audit-repository.js";

export interface MigrationPreviewSummary {
	jobId: string;
	token: string;
	total: number;
	counts: Record<string, number>;
	examples: Record<string, string[]>;
}

export class MigrationService {
	constructor(
		private readonly config: AppConfig,
		private readonly parser: LegacyNicknameParser,
		private readonly migrations: MigrationRepository,
		private readonly permissions: PermissionService,
		private readonly audits: AuditRepository
	) {}

	async preview(guild: Guild, actorId: string): Promise<MigrationPreviewSummary> {
		const members = await guild.members.fetch();
		const items = [...members.values()].filter((member) => !member.user.bot).map((member) => this.previewMember(member));
		const fingerprint = digest(items.map((x) => x.fingerprint).join("|"));
		const snapshot = JSON.stringify({
			namedRoleId: this.config.VERIFIED_NAMED_ROLE_ID,
			privateRoleId: this.config.VERIFIED_PRIVATE_ROLE_ID,
			unregisteredRoleId: this.config.UNREGISTERED_ROLE_ID,
			unknownPolicy: this.config.UNKNOWN_MEMBER_MIGRATION_POLICY,
			routes: this.config.LEGACY_RIOT_ACCOUNT_ROUTES,
		});
		const job = this.migrations.createPreview(guild.id, actorId, snapshot, fingerprint, items);
		for (const item of items)
			this.audits.create({
				guildId: guild.id,
				targetUserId: item.userId,
				actorUserId: actorId,
				action: "MIGRATION_CLASSIFICATION",
				result: item.parsed.category,
				metadata: { migrationJobId: job.id },
			});
		const token = this.createConfirmation(job.id);
		const counts: Record<string, number> = {};
		const examples: Record<string, string[]> = {};
		for (const item of items) {
			counts[item.parsed.category] = (counts[item.parsed.category] ?? 0) + 1;
			examples[item.parsed.category] ??= [];
			if (examples[item.parsed.category]!.length < 3) examples[item.parsed.category]!.push(maskExample(item.nickname, item.userId));
		}
		return { jobId: job.id, token, total: items.length, counts, examples };
	}

	createConfirmation(jobId: string): string {
		const token = randomBytes(8).toString("hex");
		this.migrations.setConfirmation(jobId, digest(token), Date.now() + 10 * 60_000);
		return token;
	}

	confirm(jobId: string, actorId: string, token: string): boolean {
		const job = this.migrations.getJob(jobId);
		if (!job || job.status !== "PREVIEWED" || job.startedBy !== actorId || !job.confirmationHash || !job.confirmationExpiresAt || job.confirmationExpiresAt < Date.now())
			return false;
		const active = this.migrations.active(job.guildId);
		if (active && active.id !== job.id) return false;
		if (digest(token) !== job.confirmationHash) return false;
		this.migrations.start(jobId);
		return true;
	}

	private previewMember(member: GuildMember) {
		let parsed: LegacyParseResult;
		let manageable = member.manageable && member.id !== member.guild.ownerId;
		if (this.permissions.isExempt(member))
			parsed = {
				category: "EXEMPT",
				originalNickname: member.nickname,
				displayName: null,
				gameName: null,
				tagLine: null,
				nameVisibility: null,
			};
		else if (!manageable)
			parsed = {
				category: "UNMANAGEABLE",
				originalNickname: member.nickname,
				displayName: null,
				gameName: null,
				tagLine: null,
				nameVisibility: null,
			};
		else parsed = this.parser.parse(member.nickname);
		const roleIds = [...member.roles.cache.keys()].sort();
		const fingerprint = digest(
			JSON.stringify({
				id: member.id,
				username: member.user.username,
				nickname: member.nickname,
				roleIds,
			})
		);
		return {
			guildId: member.guild.id,
			userId: member.id,
			username: member.user.username,
			nickname: member.nickname,
			parsed,
			manageable,
			fingerprint,
			estimatedOperations: estimate(parsed.category),
		};
	}
}

export function memberFingerprint(member: GuildMember): string {
	return digest(
		JSON.stringify({
			id: member.id,
			username: member.user.username,
			nickname: member.nickname,
			roleIds: [...member.roles.cache.keys()].sort(),
		})
	);
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const maskExample = (nickname: string | null, userId: string) => `${nickname?.slice(0, 24) ?? "(kein Nickname)"} · …${userId.slice(-4)}`;
const estimate = (category: string) =>
	category.startsWith("LEGACY_REGISTERED")
		? ["RIOT_LOOKUP", "ROLE_CHANGES", "NICKNAME"]
		: category === "LEGACY_VERIFIED_NO_RIOT"
			? ["ROLE_CHANGES"]
			: category === "LEGACY_UNREGISTERED"
				? ["ROLE_CHANGES", "NICKNAME"]
				: [];
