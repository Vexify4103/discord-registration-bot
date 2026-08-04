import { mongoCollections, type MongoDatabaseContext } from "../../database/mongo-client.js";
import { isDuplicateKey } from "./helpers.js";

interface WorkerLeaseDocument {
	name: string;
	owner: string;
	expiresAt: number;
	updatedAt: number;
}

export class WorkerLeaseRepository {
	constructor(
		private readonly database: MongoDatabaseContext,
		readonly owner = `${process.pid}:${crypto.randomUUID()}`
	) {}

	async acquire(name: string, ttlMs: number, now = Date.now()): Promise<boolean> {
		const collection = this.database.collection<WorkerLeaseDocument>(mongoCollections.workerLeases);
		const updated = await collection.updateOne(
			{ name, $or: [{ expiresAt: { $lt: now } }, { owner: this.owner }] },
			{ $set: { owner: this.owner, expiresAt: now + ttlMs, updatedAt: now } }
		);
		if (updated.modifiedCount === 1 || updated.matchedCount === 1) return true;
		try {
			await collection.insertOne({ name, owner: this.owner, expiresAt: now + ttlMs, updatedAt: now });
			return true;
		} catch (error) {
			if (isDuplicateKey(error)) return false;
			throw error;
		}
	}

	async release(name: string): Promise<void> {
		await this.database.collection<WorkerLeaseDocument>(mongoCollections.workerLeases).deleteOne({ name, owner: this.owner });
	}
}
