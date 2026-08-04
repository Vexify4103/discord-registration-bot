import { DiscordAPIError, WebhookClient } from "discord.js";
import type { Logger } from "pino";
import type { AppConfig } from "../config/schema.js";
import { safeErrorDetails } from "../logging/safe-error.js";
import type { DiscordAuditOutboxRepository } from "../repositories/discord-audit-outbox-repository.js";
import type { WorkerLeaseRepository } from "../repositories/worker-lease-repository.js";
import type { DiscordAuditPresenter } from "../services/discord-audit-presenter.js";

export class DiscordAuditLogWorker {
	private readonly webhook?: WebhookClient;
	private timer?: NodeJS.Timeout;
	private running = false;

	constructor(
		config: AppConfig,
		private readonly outbox: DiscordAuditOutboxRepository,
		private readonly presenter: DiscordAuditPresenter,
		private readonly leases: WorkerLeaseRepository,
		private readonly logger: Logger
	) {
		if (config.BOT_LOG_WEBHOOK_URL)
			this.webhook = new WebhookClient({ url: config.BOT_LOG_WEBHOOK_URL }, { allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } });
	}

	start(): void {
		if (!this.webhook) {
			this.logger.info("Discord audit webhook logging is disabled");
			return;
		}
		this.timer = setInterval(() => void this.tick(), 1_500);
		void this.tick();
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.webhook?.destroy();
	}

	async tick(): Promise<void> {
		if (!this.webhook || this.running || !this.leases.acquire("discord-audit-log", 60_000)) return;
		this.running = true;
		try {
			const item = this.outbox.due(Date.now(), 1)[0];
			if (!item) return;
			try {
				await this.webhook.send({
					embeds: [this.presenter.embed(item.event)],
					allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
				});
				this.outbox.complete(item.event.id);
			} catch (error) {
				const failure = classifyWebhookError(error);
				this.outbox.fail(item.event.id, failure.code, failure.retryable);
				this.logger.warn(
					{ error: safeErrorDetails(error), eventId: item.event.id, action: item.event.action, errorCode: failure.code },
					"Discord audit webhook delivery failed"
				);
			}
		} catch (error) {
			this.logger.error({ error: safeErrorDetails(error) }, "Discord audit log worker failed");
		} finally {
			this.running = false;
			this.leases.release("discord-audit-log");
		}
	}
}

export function classifyWebhookError(error: unknown): { retryable: boolean; code: string } {
	if (error instanceof DiscordAPIError) {
		if (error.status === 400) return { retryable: false, code: "DISCORD_WEBHOOK_INVALID_PAYLOAD" };
		if ([401, 403, 404].includes(error.status)) return { retryable: true, code: `DISCORD_WEBHOOK_HTTP_${error.status}` };
		if (error.status === 429 || error.status >= 500) return { retryable: true, code: `DISCORD_WEBHOOK_HTTP_${error.status}` };
	}
	return { retryable: true, code: "DISCORD_WEBHOOK_TEMPORARY" };
}
