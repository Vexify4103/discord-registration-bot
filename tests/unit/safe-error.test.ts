import { describe, expect, it } from "vitest";
import { safeErrorDetails } from "../../src/logging/safe-error.js";

describe("safeErrorDetails", () => {
	it("keeps stable error classification without leaking URLs, tokens, messages, or stacks", () => {
		const error = Object.assign(new Error("https://discord.com/api/webhooks/secret/callback"), {
			code: 10062,
			status: 404,
			requestBody: { token: "secret" },
		});
		const details = safeErrorDetails(error);
		expect(details).toEqual({ type: "Error", code: 10062, status: 404 });
		expect(JSON.stringify(details)).not.toContain("secret");
		expect(JSON.stringify(details)).not.toContain("discord.com");
	});
});
