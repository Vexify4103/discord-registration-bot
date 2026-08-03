import { AsyncPriorityQueue } from "../utils/async-priority-queue.js";

export class RiotRequestQueue {
	private readonly queue: AsyncPriorityQueue;
	private blockedUntil = 0;
	private authenticationBlocked = false;

	constructor(minDelayMs: number) {
		this.queue = new AsyncPriorityQueue(1, minDelayMs);
	}

	run<T>(task: () => Promise<T>, priority: number): Promise<T> {
		return this.queue.add(async () => {
			if (this.authenticationBlocked) throw new Error("RIOT_AUTHENTICATION_BLOCKED");
			const wait = this.blockedUntil - Date.now();
			if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
			return task();
		}, priority);
	}

	rateLimited(retryAfterSeconds: number): void {
		this.blockedUntil = Math.max(this.blockedUntil, Date.now() + retryAfterSeconds * 1000);
	}
	blockAuthentication(): void {
		this.authenticationBlocked = true;
	}
	resetAuthentication(): void {
		this.authenticationBlocked = false;
	}
	stop(): void {
		this.queue.stop();
	}
}
