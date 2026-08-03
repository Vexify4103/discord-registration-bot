import type { Logger } from "pino";
import type { CanonicalRiotAccount } from "../../types/domain.js";
import { RiotRequestQueue } from "../../queues/riot-request-queue.js";

export type RiotResult =
	| { kind: "success"; account: CanonicalRiotAccount }
	| { kind: "not-found" }
	| { kind: "authentication-failure" }
	| { kind: "temporary-failure"; code: string; retryAfterMs?: number }
	| { kind: "invalid-request" };

export class RiotAccountService {
	constructor(
		private readonly apiKey: string | undefined,
		private readonly queue: RiotRequestQueue,
		private readonly maxRetries: number,
		private readonly logger: Logger
	) {}

	byRiotId(route: string, gameName: string, tagLine: string, priority = 100): Promise<RiotResult> {
		return this.request(route, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, priority);
	}

	byPuuid(route: string, puuid: string, priority = 40): Promise<RiotResult> {
		return this.request(route, `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`, priority);
	}

	private request(route: string, path: string, priority: number): Promise<RiotResult> {
		return this.queue
			.run(() => this.perform(route, path), priority)
			.catch((error: unknown) => {
				const code = error instanceof Error ? error.message : "RIOT_QUEUE_FAILURE";
				return {
					kind: code === "RIOT_AUTHENTICATION_BLOCKED" ? "authentication-failure" : "temporary-failure",
					code,
				} as RiotResult;
			});
	}

	private async perform(route: string, path: string): Promise<RiotResult> {
		if (!this.apiKey) return { kind: "authentication-failure" };
		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			try {
				const response = await fetch(`https://${route}.api.riotgames.com${path}`, {
					headers: { "X-Riot-Token": this.apiKey },
					signal: AbortSignal.timeout(8_000),
				});
				if (response.status === 200) {
					const data = (await response.json()) as Partial<CanonicalRiotAccount>;
					if (!data.puuid || !data.gameName || !data.tagLine) return { kind: "temporary-failure", code: "INVALID_RIOT_RESPONSE" };
					return {
						kind: "success",
						account: {
							puuid: data.puuid,
							gameName: data.gameName,
							tagLine: data.tagLine,
						},
					};
				}
				if (response.status === 404) return { kind: "not-found" };
				if (response.status === 401 || response.status === 403) {
					this.queue.blockAuthentication();
					return { kind: "authentication-failure" };
				}
				if (response.status === 400) return { kind: "invalid-request" };
				if (response.status === 429) {
					const retryAfter = Math.max(1, Number(response.headers.get("retry-after") ?? 1));
					this.queue.rateLimited(retryAfter);
					if (attempt === this.maxRetries)
						return {
							kind: "temporary-failure",
							code: "RIOT_RATE_LIMITED",
							retryAfterMs: retryAfter * 1000,
						};
					await delay(retryAfter * 1000);
					continue;
				}
				if (response.status >= 500 && attempt < this.maxRetries) {
					await delay(backoff(attempt));
					continue;
				}
				return {
					kind: "temporary-failure",
					code: `RIOT_HTTP_${response.status}`,
				};
			} catch (error) {
				this.logger.warn({ err: error, attempt }, "Riot request failed");
				if (attempt === this.maxRetries)
					return {
						kind: "temporary-failure",
						code: error instanceof DOMException && error.name === "TimeoutError" ? "RIOT_TIMEOUT" : "RIOT_NETWORK",
					};
				await delay(backoff(attempt));
			}
		}
		return { kind: "temporary-failure", code: "RIOT_UNKNOWN" };
	}
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const backoff = (attempt: number) => Math.min(30_000, 2 ** attempt * 500 + Math.floor(Math.random() * 500));
