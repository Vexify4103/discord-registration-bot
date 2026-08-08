export type RiotRoute = "americas" | "asia" | "europe" | "sea";
export interface ParsedOpggUrl {
	gameName: string;
	tagLine: string;
	platformRegion: string;
	accountRoutingGroup: RiotRoute;
	normalizedUrl: string;
}

const platforms: Record<string, { platform: string; route: RiotRoute }> = {
	euw: { platform: "EUW1", route: "europe" },
	eune: { platform: "EUN1", route: "europe" },
	tr: { platform: "TR1", route: "europe" },
	ru: { platform: "RU", route: "europe" },
	na: { platform: "NA1", route: "americas" },
	br: { platform: "BR1", route: "americas" },
	lan: { platform: "LA1", route: "americas" },
	las: { platform: "LA2", route: "americas" },
	oce: { platform: "OC1", route: "americas" },
	kr: { platform: "KR", route: "asia" },
	jp: { platform: "JP1", route: "asia" },
	sg: { platform: "SG2", route: "sea" },
	ph: { platform: "PH2", route: "sea" },
	tw: { platform: "TW2", route: "sea" },
	th: { platform: "TH2", route: "sea" },
	vn: { platform: "VN2", route: "sea" },
};
const platformSlugs: Record<string, string> = Object.fromEntries(Object.entries(platforms).map(([slug, value]) => [value.platform, slug]));

export interface RiotPlatform {
	platformRegion: string;
	accountRoutingGroup: RiotRoute;
}

export function parseRiotPlatform(value: string): RiotPlatform | null {
	const normalized = value.trim().toLowerCase();
	const match = platforms[normalized] ?? Object.values(platforms).find((candidate) => candidate.platform.toLowerCase() === normalized);
	return match ? { platformRegion: match.platform, accountRoutingGroup: match.route } : null;
}

export function parseRiotId(value: string): { gameName: string; tagLine: string } | null {
	const normalized = value.trim();
	const separator = normalized.lastIndexOf("#");
	if (separator <= 0 || separator === normalized.length - 1) return null;
	const gameName = normalized.slice(0, separator).trim();
	const tagLine = normalized.slice(separator + 1).trim();
	if (!gameName || !tagLine || gameName.length > 64 || tagLine.length > 16 || /[\r\n]/.test(gameName + tagLine)) return null;
	return { gameName, tagLine };
}

export function buildOpggUrl(platformRegion: string, gameName: string, tagLine: string): string {
	const slug = platformSlugs[platformRegion.toUpperCase()];
	if (!slug) throw new Error("UNSUPPORTED_RIOT_PLATFORM");
	return `https://www.op.gg/lol/summoners/${slug}/${encodeURIComponent(`${gameName}-${tagLine}`)}`;
}

export class OpggParser {
	parse(value: string): ParsedOpggUrl | null {
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			return null;
		}
		if (url.protocol !== "https:" || !["op.gg", "www.op.gg"].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port || url.hash || url.search)
			return null;
		let parts: string[];
		try {
			parts = url.pathname
				.split("/")
				.filter(Boolean)
				.map((p) => decodeURIComponent(p));
		} catch {
			return null;
		}
		if (parts.length === 5 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0]!)) parts = parts.slice(1);
		if (parts.length !== 4 || parts[0]?.toLowerCase() !== "lol" || parts[1]?.toLowerCase() !== "summoners") return null;
		const platform = platforms[parts[2]!.toLowerCase()];
		if (!platform) return null;
		const identity = parts[3]!;
		const separator = identity.lastIndexOf("-");
		if (separator <= 0 || separator === identity.length - 1) return null;
		const parsedIdentity = parseRiotId(`${identity.slice(0, separator)}#${identity.slice(separator + 1)}`);
		if (!parsedIdentity) return null;
		const { gameName, tagLine } = parsedIdentity;
		const normalizedUrl = buildOpggUrl(platform.platform, gameName, tagLine);
		return {
			gameName,
			tagLine,
			platformRegion: platform.platform,
			accountRoutingGroup: platform.route,
			normalizedUrl,
		};
	}
}
