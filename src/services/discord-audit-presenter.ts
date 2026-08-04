import { EmbedBuilder } from "discord.js";
import type { AppConfig } from "../config/schema.js";
import type { AuditEvent } from "../database/schema/index.js";
import type { Localizer } from "../localization/formatter.js";
import type { MessageKey } from "../localization/keys.js";

const SUCCESS = 0x57f287;
const WARNING = 0xfee75c;
const ERROR = 0xed4245;
const INFO = 0x5865f2;

export class DiscordAuditPresenter {
	constructor(
		private readonly config: AppConfig,
		private readonly i18n: Localizer
	) {}

	embed(event: AuditEvent): EmbedBuilder {
		const role = this.roleId(event);
		const added = event.action.startsWith("ADD_");
		const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
		if (event.targetUserId) fields.push({ name: this.i18n.t("auditLog.field.member"), value: `<@${event.targetUserId}>`, inline: true });
		fields.push({
			name: this.i18n.t("auditLog.field.actor"),
			value: event.actorUserId ? `<@${event.actorUserId}>` : this.i18n.t("auditLog.actor.automatic"),
			inline: true,
		});
		if (role)
			fields.push({
				name: this.i18n.t(added ? "auditLog.field.added" : "auditLog.field.removed"),
				value: `<@&${role}>`,
				inline: false,
			});
		fields.push({ name: this.i18n.t("auditLog.field.reason"), value: this.i18n.t(this.reasonKey(event.action)), inline: false });
		fields.push({ name: this.i18n.t("auditLog.field.result"), value: this.result(event.result), inline: true });

		return new EmbedBuilder()
			.setColor(this.color(event))
			.setTitle(this.i18n.t(this.titleKey(event.action)))
			.addFields(fields)
			.setFooter({ text: this.i18n.t("auditLog.footer") })
			.setTimestamp(event.createdAt);
	}

	private roleId(event: AuditEvent): string | undefined {
		const registrationRoles: Record<string, string> = {
			ADD_VERIFIED_NAMED_ROLE: this.config.VERIFIED_NAMED_ROLE_ID,
			REMOVE_VERIFIED_NAMED_ROLE: this.config.VERIFIED_NAMED_ROLE_ID,
			ADD_VERIFIED_PRIVATE_ROLE: this.config.VERIFIED_PRIVATE_ROLE_ID,
			REMOVE_VERIFIED_PRIVATE_ROLE: this.config.VERIFIED_PRIVATE_ROLE_ID,
			ADD_UNREGISTERED_ROLE: this.config.UNREGISTERED_ROLE_ID,
			REMOVE_UNREGISTERED_ROLE: this.config.UNREGISTERED_ROLE_ID,
		};
		if (registrationRoles[event.action]) return registrationRoles[event.action];
		if (event.action !== "ADD_RANK_ROLE" && event.action !== "REMOVE_RANK_ROLE") return undefined;
		const metadata = parseMetadata(event.metadata);
		return typeof metadata.roleId === "string" && /^\d{15,22}$/.test(metadata.roleId) ? metadata.roleId : undefined;
	}

	private titleKey(action: string): MessageKey {
		if (action.includes("ROLE")) return "auditLog.title.roleUpdate";
		if (action === "SET_NICKNAME") return "auditLog.title.nicknameUpdate";
		if (action === "REGISTRATION_DATA_DELETED") return "auditLog.title.dataProtection";
		if (action.startsWith("REGISTRATION_") || action === "USER_UNREGISTERED") return "auditLog.title.registration";
		if (action === "MEMBER_JOINED" || action === "MEMBER_LEFT") return "auditLog.title.memberLifecycle";
		if (action.startsWith("CLEANUP_")) return "auditLog.title.cleanup";
		if (action.startsWith("MIGRATION_")) return "auditLog.title.migration";
		if (action.startsWith("ADMIN_NICKNAME_")) return "auditLog.title.administrativeNickname";
		return "auditLog.title.generic";
	}

	private reasonKey(action: string): MessageKey {
		if (action === "ADD_RANK_ROLE" || action === "REMOVE_RANK_ROLE") return "auditLog.reason.rankSync";
		if (action.includes("ROLE")) return "auditLog.reason.registrationSync";
		if (action === "SET_NICKNAME") return "auditLog.reason.nicknameSync";
		if (action === "REGISTRATION_DATA_DELETED") return "auditLog.reason.dataProtection";
		if (action.startsWith("REGISTRATION_") || action === "USER_UNREGISTERED") return "auditLog.reason.registration";
		if (action === "MEMBER_JOINED" || action === "MEMBER_LEFT") return "auditLog.reason.memberLifecycle";
		if (action.startsWith("CLEANUP_")) return "auditLog.reason.cleanup";
		if (action.startsWith("MIGRATION_")) return "auditLog.reason.migration";
		if (action.startsWith("ADMIN_NICKNAME_")) return "auditLog.reason.administrativeNickname";
		return "auditLog.reason.generic";
	}

	private result(result: string): string {
		if (["SUCCESS", "SUCCEEDED"].includes(result)) return this.i18n.t("auditLog.result.success");
		if (["NO_OP", "NO-OP"].includes(result)) return this.i18n.t("auditLog.result.noop");
		if (["RETRYABLE", "PENDING"].includes(result)) return this.i18n.t("auditLog.result.pending");
		if (result === "STARTED") return this.i18n.t("auditLog.result.started");
		return this.i18n.t("auditLog.result.failed");
	}

	private color(event: AuditEvent): number {
		if (!["SUCCESS", "SUCCEEDED", "NO_OP", "NO-OP"].includes(event.result)) return event.result === "STARTED" ? WARNING : ERROR;
		if (event.action.startsWith("REMOVE_") || event.action.includes("UNREGISTERED") || event.action.includes("LEFT")) return WARNING;
		if (event.action.includes("ROLE") || event.action === "SET_NICKNAME") return WARNING;
		if (event.action.startsWith("CLEANUP_")) return ERROR;
		return event.action.startsWith("REGISTRATION_") ? SUCCESS : INFO;
	}
}

function parseMetadata(value: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}
