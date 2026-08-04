export interface SafeErrorDetails {
	type: string;
	code?: string | number;
	status?: number;
}

export function safeErrorDetails(error: unknown): SafeErrorDetails {
	if (!error || typeof error !== "object") return { type: typeof error };
	const value = error as { name?: unknown; constructor?: { name?: unknown }; code?: unknown; status?: unknown };
	const type = typeof value.name === "string" ? value.name : typeof value.constructor?.name === "string" ? value.constructor.name : "Error";
	return {
		type,
		...(typeof value.code === "string" || typeof value.code === "number" ? { code: value.code } : {}),
		...(typeof value.status === "number" ? { status: value.status } : {}),
	};
}
