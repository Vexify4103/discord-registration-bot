interface QueueEntry<T> {
	priority: number;
	sequence: number;
	task: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
}

export class AsyncPriorityQueue {
	private readonly queue: QueueEntry<unknown>[] = [];
	private active = 0;
	private sequence = 0;
	private stopped = false;
	private lastStartedAt = 0;

	constructor(
		private readonly concurrency = 1,
		private readonly minDelayMs = 0
	) {}

	add<T>(task: () => Promise<T>, priority = 0): Promise<T> {
		if (this.stopped) return Promise.reject(new Error("QUEUE_STOPPED"));
		return new Promise<T>((resolve, reject) => {
			this.queue.push({
				priority,
				sequence: this.sequence++,
				task,
				resolve,
				reject,
			} as QueueEntry<unknown>);
			this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
			void this.drain();
		});
	}

	stop(): void {
		this.stopped = true;
	}
	get size(): number {
		return this.queue.length;
	}

	private async drain(): Promise<void> {
		while (!this.stopped && this.active < this.concurrency && this.queue.length) {
			const entry = this.queue.shift()!;
			this.active++;
			const wait = Math.max(0, this.minDelayMs - (Date.now() - this.lastStartedAt));
			if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
			this.lastStartedAt = Date.now();
			void entry
				.task()
				.then(entry.resolve, entry.reject)
				.finally(() => {
					this.active--;
					void this.drain();
				});
		}
	}
}
