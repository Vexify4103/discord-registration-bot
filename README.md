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

Sichtbare Registrierungen verwenden `Name | RiotID#Tag`. Private Registrierungen verwenden `? | RiotID#Tag`; für sie bleibt `displayName=null`, sodass das Fragezeichen nur ein sichtbarer Platzhalter und kein gespeicherter Personenname ist.

Automatische Entfernungen nicht registrierter Mitglieder sind standardmäßig deaktiviert. Nur `CLEANUP_ENABLED=true` aktiviert den Kick-Worker; `REGISTRATION_EXPIRY_DAYS` legt dann die Frist fest.

## Betrieb

Siehe [Deployment](docs/deployment.md) und [Backup/Wiederherstellung](docs/backup-recovery.md).

### Registrierungsmigration

- `/registration-setup mode:Vorschau` erstellt eine unveränderliche Vorschau und ändert noch keine Mitglieder.
- Nach der Bestätigung mit **Migration anwenden** wird die Migration im Hintergrund verarbeitet.
- `/registration-setup mode:Status` zeigt Fortschritt, offene Fälle, manuelle Prüfungen und Fehler.
- `/registration-setup mode:Pausieren` stoppt die Verarbeitung nach dem bereits begonnenen Mitglied.
- `/registration-setup mode:Fortsetzen` setzt eine pausierte Migration fort.
- `/registration-setup mode:Abbrechen` beendet einen laufenden oder pausierten Job, ohne bereits verarbeitete Mitglieder zurückzusetzen. Danach kann eine neue Vorschau erstellt werden.

`Name | ?#?` wird als `VERIFIED_NO_RIOT` übernommen: Der bekannte Name und der Nickname bleiben erhalten, das Mitglied erhält die Rolle **Verifiziert** und wird weder per Riot synchronisiert noch vom Cleanup erfasst. Wird bei `Name | RiotID#Tag` das alte Riot-Konto nicht gefunden, verwendet der Bot ebenfalls diesen Zustand und normalisiert den Nickname zu `Name | ?#?`. Ein nicht gefundenes verborgenes Konto ohne bekannten Namen bleibt dagegen in `PENDING_VERIFICATION` und wird als `MANUAL_REVIEW` gespeichert.
