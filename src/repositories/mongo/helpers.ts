import type { Document, WithId } from "mongodb";

export function withoutMongoId<T extends Document>(value: WithId<T> | null): T | undefined {
	if (!value) return undefined;
	const { _id: _ignored, ...document } = value;
	return document as unknown as T;
}

export function withoutMongoIds<T extends Document>(values: Array<WithId<T>>): T[] {
	return values.map((value) => withoutMongoId(value)!);
}

export function isDuplicateKey(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 11000);
}
