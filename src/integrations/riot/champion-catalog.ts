import type { Logger } from "pino";

export class ChampionCatalog {
	private byId = new Map<number, string>();
	private expiresAt = 0;
	constructor(private readonly logger: Logger) {}

	async name(championId: number): Promise<string> {
		await this.ensureLoaded();
		return this.byId.get(championId) ?? `#${championId}`;
	}

	async resolve(input: string): Promise<number | undefined> {
		const numeric = Number(input);
		if (Number.isInteger(numeric) && numeric > 0) return numeric;
		await this.ensureLoaded();
		const normalized = normalize(input);
		return [...this.byId].find(([, name]) => normalize(name) === normalized)?.[0];
	}

	private async ensureLoaded(): Promise<void> {
		if (this.byId.size && this.expiresAt > Date.now()) return;
		try {
			const versions = (await fetch("https://ddragon.leagueoflegends.com/api/versions.json", { signal: AbortSignal.timeout(5_000) }).then((r) => r.json())) as unknown;
			if (!Array.isArray(versions) || typeof versions[0] !== "string") throw new Error("INVALID_DDRAGON_VERSIONS");
			const payload = (await fetch(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/de_DE/champion.json`, { signal: AbortSignal.timeout(5_000) }).then((r) =>
				r.json()
			)) as { data?: Record<string, { key?: string; name?: string }> };
			const next = new Map<number, string>();
			for (const champion of Object.values(payload.data ?? {})) if (champion.key && champion.name) next.set(Number(champion.key), champion.name);
			if (!next.size) throw new Error("INVALID_DDRAGON_CHAMPIONS");
			this.byId = next;
			this.expiresAt = Date.now() + 24 * 60 * 60_000;
		} catch (error) {
			this.logger.warn({ err: error }, "Data Dragon champion catalog unavailable");
		}
	}
}

const normalize = (value: string) =>
	value
		.normalize("NFKD")
		.replace(/\p{Diacritic}/gu, "")
		.replace(/[^a-z0-9]/gi, "")
		.toLowerCase();
