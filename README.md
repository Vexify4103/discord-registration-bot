# Discord-Registrierungsbot

[Nutzungsbedingungen](https://vexify4103.github.io/discord-registration-bot/terms.html) · [Datenschutzerklärung](https://vexify4103.github.io/discord-registration-bot/privacy.html)

Ein einzelner TypeScript/discord.js-Prozess verwaltet Registrierungen, Riot-Identitäten, Discord-Rollen, Nicknames sowie League-Ränge und Champion-Mastery. SQLite/Drizzle ist die Quelle der Wahrheit. Ein Web-Dashboard ist nicht erforderlich.

Der Bot zeigt standardmäßig die Aktivität **Spielt Rollen-Tetris**. Der Text kann über `BOT_ACTIVITY_TEXT` geändert werden.

## Entwicklung

1. Node.js 24 LTS installieren.
2. `.env.example` nach `.env` kopieren und Werte ergänzen.
3. `npm install`
4. `npm run db:migrate`
5. `npm test && npm run build`
6. `npm run dev`

Im Discord Developer Portal muss unter **Bot → Privileged Gateway Intents** der **Server Members Intent** aktiviert werden. Der Bot benötigt View Channels, Send Messages, Use Application Commands, Manage Nicknames, Manage Roles, Kick Members und **View Audit Log**, aber keine Administratorberechtigung.

Die Rollen werden nicht automatisch verändert. Die erwartete Reihenfolge ist Bot, Staff, Verifiziert, Verifiziert | Privat, Unregistriert, @everyone. Beide verifizierten Rollen müssen separat angezeigt werden; Unregistriert darf nicht separat angezeigt werden.

Sichtbare Registrierungen verwenden `Name | RiotID#Tag`. Private Registrierungen verwenden `? | RiotID#Tag`; für sie bleibt `displayName=null`, sodass das Fragezeichen nur ein sichtbarer Platzhalter und kein gespeicherter Personenname ist.

Ändert ein berechtigtes Staff-Mitglied den Server-Nickname manuell auf `Name | RiotID#Tag`, `? | RiotID#Tag` oder `Name | ?#?`, übernimmt der Bot die Änderung automatisch in die Datenbank und gleicht die Registrierungsrollen ab. Der Bearbeiter wird sicher über das Discord-Audit-Log bestimmt. Änderungen des Bots selbst oder nicht berechtigter Mitglieder werden nicht als Registrierungsdaten übernommen. Doppelte Riot-Konten benötigen weiterhin eine ausdrückliche administrative Freigabe über `/register-user`.

Automatische Entfernungen nicht registrierter Mitglieder sind standardmäßig deaktiviert. Nur `CLEANUP_ENABLED=true` aktiviert den Kick-Worker; `REGISTRATION_EXPIRY_DAYS` legt dann die Frist fest.

### League-Ränge und Mastery

- `/league profile`, `/league mastery`, `/league chart`, `/league top`, `/league refresh`, `/league roles`, `/league help` und `/league about` ersetzen die Discord-relevanten Profilfunktionen von OriannaBot.
- Rangrollen verwenden ausschließlich den höheren Rang aus **Solo/Duo** und **Flex**. TFT wird vollständig ausgeschlossen. Ein erfolgreich geprüftes Konto ohne Solo-/Flex-Rang erhält die eigene Unranked-Rolle.
- Mastery-Snapshots werden lokal in SQLite gespeichert. Verlaufsdiagramme beginnen daher mit dem ersten erfolgreichen Abruf nach Aktivierung dieser Version; historische Riot-Daten lassen sich nicht rückwirkend erzeugen.
- `JOIN_ENGAGEMENT_ENABLED=true` sendet neuen, noch nicht registrierten Menschen eine deutsche Willkommens-DM mit dem Hinweis auf `/register`.
- Optional akzeptiert `BOT_MENTION_COMMANDS_ENABLED=true` zusätzlich Orianna-artige Nachrichten wie `@Bot profil`, `@Bot mastery @Mitglied`, `@Bot stats Ahri`, `@Bot top Ahri`, `@Bot refresh` und `@Bot rollen`. Dafür müssen im Discord Developer Portal der **Message Content Intent** und für den Bot **Nachrichten anzeigen/senden** aktiviert sein.
- Die Riot-Warteschlange verwendet standardmäßig mindestens 1.250 ms Abstand zwischen Anfragen und respektiert zusätzlich `Retry-After`.

Für Rangrollen `RANK_ROLE_SYNC_ENABLED=true` setzen und alle elf IDs in `.env` eintragen:

```env
RANK_ROLE_UNRANKED_ID=
RANK_ROLE_IRON_ID=
RANK_ROLE_BRONZE_ID=
RANK_ROLE_SILVER_ID=
RANK_ROLE_GOLD_ID=
RANK_ROLE_PLATINUM_ID=
RANK_ROLE_EMERALD_ID=
RANK_ROLE_DIAMOND_ID=
RANK_ROLE_MASTER_ID=
RANK_ROLE_GRANDMASTER_ID=
RANK_ROLE_CHALLENGER_ID=
```

Die Bot-Rolle muss über jeder Rangrolle stehen. Der Bot verändert weder Position, Farbe, Name noch sonstige Einstellungen dieser Rollen. Pro registriertem Mitglied wird genau eine konfigurierte Rangrolle gehalten, sobald ein erfolgreicher Rangabruf vorliegt. Ohne Solo-/Flex-Eintrag wird `RANK_ROLE_UNRANKED_ID` verwendet. Solange Riot-Daten noch fehlen, bewahrt der Bot eine vorhandene Rangrolle und trifft noch keine neue Rangentscheidung.

Bei jedem Start mit aktivierter Rangrollensynchronisierung lädt der Bot die aktuelle Mitgliederliste und stellt einen vollständigen, idempotenten Sweep in die dauerhafte Discord-Warteschlange. Registrierte Riot-Konten werden nach erfolgreichem Rangabruf projiziert. `UNREGISTERED`, `VERIFIED_NO_RIOT` und bisher unbekannte Datenbankmitglieder verlieren alle konfigurierten Rangrollen; `PENDING_VERIFICATION` bleibt aus Sicherheitsgründen unangetastet. Bots werden ignoriert. Mitglieder oberhalb der Bot-Rolle können technisch nicht geändert werden und erscheinen als dauerhafter Discord-Hierarchiefehler.

## Betrieb

Siehe [Deployment](docs/deployment.md) und [Backup/Wiederherstellung](docs/backup-recovery.md).

### Registrierungsmigration

- `/registration-setup mode:Vorschau` erstellt eine unveränderliche Vorschau und ändert noch keine Mitglieder.
- Nach der Bestätigung mit **Migration anwenden** wird die Migration im Hintergrund verarbeitet.
- `/registration-setup mode:Status` zeigt ein ephemeres Fortschritts-Embed mit Balken, Zählern und automatischer Aktualisierung alle 30 Sekunden. Die automatische Anzeige läuft bis zu 14 Minuten; der Button **Aktualisieren** startet sie erneut.
- `/registration-setup mode:Manuelle Prüfungen` sowie der Button im Status zeigen alle betroffenen Mitglieder paginiert mit Discord-ID, ursprünglichem Nickname und lokalisiertem Prüfgrund.
- `/registration-setup mode:Manuelle Regeln anwenden` erstellt eine bestätigungspflichtige Folgemigration für manuelle und fehlgeschlagene Fälle. Nicht gefundene private Riot-IDs und unbekannte Formate werden nicht registriert; PUUID-Duplikate übernehmen Name, Sichtbarkeit und Riot-Identität des zuerst registrierten Discord-Kontos als genehmigtes Zweitkonto.
- `/registration-setup mode:Pausieren` stoppt die Verarbeitung nach dem bereits begonnenen Mitglied.
- `/registration-setup mode:Fortsetzen` setzt eine pausierte Migration fort.
- `/registration-setup mode:Abbrechen` beendet einen laufenden oder pausierten Job, ohne bereits verarbeitete Mitglieder zurückzusetzen. Danach kann eine neue Vorschau erstellt werden.

`Name | ?#?` wird als `VERIFIED_NO_RIOT` übernommen: Der bekannte Name und der Nickname bleiben erhalten, das Mitglied erhält die Rolle **Verifiziert** und wird weder per Riot synchronisiert noch vom Cleanup erfasst. Wird bei `Name | RiotID#Tag` das alte Riot-Konto nicht gefunden, verwendet der Bot ebenfalls diesen Zustand und normalisiert den Nickname zu `Name | ?#?`. Ein nicht gefundenes verborgenes Konto ohne bekannten Namen bleibt dagegen in `PENDING_VERIFICATION` und wird als `MANUAL_REVIEW` gespeichert.

Gaming Community Bot is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
