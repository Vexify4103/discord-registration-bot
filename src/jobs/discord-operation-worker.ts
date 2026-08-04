import type { Logger } from "pino";
import type { AppConfig } from "../config/schema.js";
import { DiscordMemberMutationQueue } from "../queues/discord-member-mutation-queue.js";
import { PendingOperationRepository } from "../repositories/mongo/pending-operation-repository.js";
import { MemberReconciliationService } from "../integrations/discord/member-reconciliation-service.js";
import { WorkerLeaseRepository } from "../repositories/mongo/worker-lease-repository.js";

export class DiscordOperationWorker {
	private timer?: NodeJS.Timeout;
	private running = false;
	constructor(
		private readonly config: AppConfig,
		private readonly operations: PendingOperationRepository,
		private readonly queue: DiscordMemberMutationQueue,
		private readonly reconciliation: MemberReconciliationService,
		private readonly leases: WorkerLeaseRepository,
		private readonly logger: Logger
	) {}

	start(): void {
		this.timer = setInterval(() => void this.tick(), 2_000);
		void this.tick();
	}
	stop(): void {
		if (this.timer) clearInterval(this.timer);
	}

	async tick(): Promise<void> {
		if (this.running) return;
		if (!(await this.leases.acquire("discord-operations", 60_000))) return;
		this.running = true;
		try {
			for (const operation of await this.operations.due()) {
				if (!(await this.operations.isCurrent(operation))) {
					await this.operations.complete(operation.id);
					continue;
				}
				await this.queue.run(`${operation.guildId}:${operation.userId}`, operation.priority, async () => {
					const result = await this.reconciliation.reconcile(operation.guildId, operation.userId);
					if (result.kind === "success" || result.kind === "no-op") await this.operations.complete(operation.id);
					else if ("code" in result) await this.operations.fail(operation.id, result.code, result.kind === "retryable", this.config.DISCORD_OPERATION_MAX_RETRIES);
				});
			}
		} catch (error) {
			this.logger.error({ err: error }, "Discord operation worker tick failed");
		} finally {
			this.running = false;
			await this.leases.release("discord-operations");
		}
	}
}
