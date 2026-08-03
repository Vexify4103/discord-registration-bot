import { AsyncPriorityQueue } from "../utils/async-priority-queue.js";

export class DiscordMemberMutationQueue {
	private readonly queue: AsyncPriorityQueue;
	private readonly locks = new Map<string, Promise<unknown>>();
	constructor(concurrency: number, minDelayMs: number) {
		this.queue = new AsyncPriorityQueue(concurrency, minDelayMs);
	}

	run<T>(memberKey: string, priority: number, task: () => Promise<T>): Promise<T> {
		const previous = this.locks.get(memberKey) ?? Promise.resolve();
		const current = previous.catch(() => undefined).then(() => this.queue.add(task, priority));
		this.locks.set(memberKey, current);
		void current.finally(() => {
			if (this.locks.get(memberKey) === current) this.locks.delete(memberKey);
		});
		return current;
	}
	stop(): void {
		this.queue.stop();
	}
}
