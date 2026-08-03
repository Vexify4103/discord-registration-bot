import { describe, expect, it } from "vitest";
import { AsyncPriorityQueue } from "../../src/utils/async-priority-queue.js";

describe("AsyncPriorityQueue", () => {
	it("runs waiting interactive work before background work", async () => {
		const queue = new AsyncPriorityQueue(1, 0);
		const order: string[] = [];
		let release!: () => void;
		const blocker = queue.add(
			() =>
				new Promise<void>((resolve) => {
					release = () => {
						order.push("first");
						resolve();
					};
				}),
			0
		);
		await Promise.resolve();
		const low = queue.add(async () => {
			order.push("low");
		}, 10);
		const high = queue.add(async () => {
			order.push("high");
		}, 100);
		release();
		await Promise.all([blocker, low, high]);
		expect(order).toEqual(["first", "high", "low"]);
	});
});
