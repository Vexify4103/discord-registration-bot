import type { Logger } from "pino";
import { AuditRepository } from "../repositories/audit-repository.js";
import { RegistrationRepository } from "../repositories/registration-repository.js";
import { WorkerLeaseRepository } from "../repositories/worker-lease-repository.js";

export class RetentionWorker {
	private timer?: NodeJS.Timeout;
	constructor(
		private readonly registrations: RegistrationRepository,
		private readonly audits: AuditRepository,
		private readonly leases: WorkerLeaseRepository,
		private readonly logger: Logger
	) {}
	start(): void {
		this.timer = setInterval(() => this.tick(), 60 * 60_000);
		this.tick();
	}
	stop(): void {
		if (this.timer) clearInterval(this.timer);
	}
	tick(): void {
		if (!this.leases.acquire("retention", 60_000)) return;
		try {
			const purged = this.registrations.purgeRetained();
			const audits = this.audits.deleteOlderThan(Date.now() - 180 * 86_400_000);
			if (purged || audits) this.logger.info({ retainedRowsPurged: purged, auditRowsPurged: audits }, "Retention cleanup completed");
		} catch (error) {
			this.logger.error({ err: error }, "Retention worker failed");
		} finally {
			this.leases.release("retention");
		}
	}
}
