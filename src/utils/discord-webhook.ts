export interface DiscordWebhookCredentials {
	id: string;
	token: string;
}

export function parseDiscordWebhookUrl(value: string): DiscordWebhookCredentials | null {
	try {
		const url = new URL(value);
		const match = url.pathname.match(/^\/api(?:\/v\d+)?\/webhooks\/(\d{15,22})\/([A-Za-z0-9._-]+)\/?$/);
		return match ? { id: match[1]!, token: match[2]! } : null;
	} catch {
		return null;
	}
}
