# Discord-Registrierungsbot

[Nutzungsbedingungen](https://vexify4103.github.io/discord-registration-bot/terms.html) · [Datenschutzerklärung](https://vexify4103.github.io/discord-registration-bot/privacy.html)

Ein einzelner TypeScript/discord.js-Prozess verwaltet Registrierungen, Riot-Identitäten, drei Discord-Rollen und Nicknames. SQLite/Drizzle ist die Quelle der Wahrheit.

## Entwicklung

1. Node.js 24 LTS installieren.
2. `.env.example` nach `.env` kopieren und Werte ergänzen.
3. `npm install`
4. `npm run db:migrate`
5. `npm test && npm run build`
6. `npm run dev`

Im Discord Developer Portal muss unter **Bot → Privileged Gateway Intents** der **Server Members Intent** aktiviert werden. Der Bot benötigt View Channels, Send Messages, Use Application Commands, Manage Nicknames, Manage Roles und Kick Members, aber keine Administratorberechtigung.

Die Rollen werden nicht automatisch verändert. Die erwartete Reihenfolge ist Bot, Staff, Verifiziert, Verifiziert | Privat, Unregistriert, @everyone. Beide verifizierten Rollen müssen separat angezeigt werden; Unregistriert darf nicht separat angezeigt werden.

## Betrieb

Siehe [Deployment](docs/deployment.md) und [Backup/Wiederherstellung](docs/backup-recovery.md).
