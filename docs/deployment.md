# Deployment auf Raspberry Pi

Unterstützt werden Raspberry Pi 4/5 mit 64-Bit Raspberry Pi OS und Node.js 24 LTS. Die produktive Datenhaltung liegt in einer MongoDB-Replikatgruppe; die bisherige SQLite-Datei wird nur für den einmaligen Import und als Rückfallkopie benötigt.

1. Dienstkonto `discord-registration` ohne Login-Shell anlegen.
2. Release nach `/opt/discord-registration/releases/<version>` kopieren und `npm ci --omit=dev` ausführen. Falls kein ARM64-Prebuild verfügbar ist, vorher `python3`, `make` und `g++` installieren.
3. Umgebungsdatei `/etc/discord-registration-bot.env` beziehungsweise `.env` mit Modus `0600` anlegen. `MONGODB_URI`, `MONGODB_DATABASE=gaming_community` und für den Erstimport `SQLITE_IMPORT_PATH` setzen.
4. Für den MongoDB-Benutzer ausschließlich `readWrite` auf `gaming_community` vergeben. Die URI muss `authSource=gaming_community`, `replicaSet=gaming-rs`, `directConnection=true`, `retryWrites=true` und `w=majority` enthalten.
5. Vor der Umstellung den Bot stoppen, SQLite sichern und mit `PRAGMA integrity_check` prüfen. Danach den einmaligen Import ausführen und erst nach erfolgreicher Zählprüfung den Bot wieder starten.
6. Symlink `/opt/discord-registration/current` atomar auf das neue Release umstellen.
7. Die mitgelieferte systemd-Unit installieren, `systemctl daemon-reload`, `enable` und `start` ausführen.
8. `journalctl -u discord-registration-bot` auf deutsche Konfigurationsdiagnosen prüfen.

Die Bot-Rolle benötigt zusätzlich **Audit-Log anzeigen**, damit manuelle Nickname-Änderungen ausschließlich dann als Registrierungsänderung übernommen werden, wenn Discord sie einem berechtigten Staff-Mitglied zuordnet.

Für den aktuell angelegten Datenbankbenutzer lautet das URI-Schema (Passwort URL-kodieren, falls es Sonderzeichen enthält):

```env
MONGODB_URI=mongodb://gamingcommunity_bot:PASSWORD@MONGO_HOST:25078/gaming_community?authSource=gaming_community&directConnection=true&replicaSet=gaming-rs&retryWrites=true&w=majority
MONGODB_DATABASE=gaming_community
SQLITE_IMPORT_PATH=./data/bot.sqlite
MASTERY_HISTORY_RETENTION_DAYS=730
```

Der Bot prüft beim Start, ob tatsächlich eine Replikatgruppe erreichbar ist, und legt die benötigten Indizes selbst an. Ein Standalone-MongoDB-Prozess wird abgelehnt, weil Registrierungsänderungen, Warteschlangen und Auditereignisse Transaktionen benötigen.

Für den Discord-Auditkanal im gewünschten Kanal einen eingehenden Webhook erstellen und `BOT_LOG_WEBHOOK_URL` setzen. Die URL ist geheim und darf weder im Repository noch in PM2-Ausgaben erscheinen. Beim Start prüft der Bot, ob der Webhook erreichbar ist und zum konfigurierten Server gehört. Discord begrenzt auch Webhooks; die persistente Outbox sendet deshalb seriell und wiederholt temporär fehlgeschlagene Meldungen automatisch.

Für die League-Erweiterung werden alle `RANK_ROLE_*_ID`-Werte aus `.env.example` mit den bestehenden Discord-Rollen befüllt und anschließend `RANK_ROLE_SYNC_ENABLED=true` gesetzt. Die Unranked-Rolle und alle zehn Rangrollen müssen eindeutige IDs haben; die Bot-Rolle muss über ihnen stehen. Mit `JOIN_ENGAGEMENT_ENABLED=true` erhalten neue, nicht registrierte Mitglieder eine Willkommens-DM. `BOT_MENTION_COMMANDS_ENABLED=true` aktiviert zusätzlich `@Bot ...`-Befehle; dafür muss im Discord Developer Portal unter **Bot → Privileged Gateway Intents** der **Message Content Intent** eingeschaltet sein. `RIOT_SYNC_MIN_DELAY_MS=1250` ist für einen persönlichen Schlüssel mit 100 Anfragen pro zwei Minuten die sichere Mindestkonfiguration.

Nach dem Update in dieser Reihenfolge ausführen:

```bash
pm2 stop GamingCommunity
npm ci
npm run build
npm test
npm run db:import:mongodb
pm2 start GamingCommunity
npx pm2 save
```

`db:import:mongodb` kopiert alle Tabellen inklusive Registrierungen, offenen Operationen, Migrationszuständen, Audits, League-Profilen, Masteries und Snapshots. Die SQLite-Datei wird nicht verändert. Derselbe Import kann nach einem Abbruch fortgesetzt werden; eine andere Quelle oder eine bereits belegte Ziel-Datenbank wird aus Sicherheitsgründen abgelehnt. Beim ersten Start werden Rang und Mastery gestaffelt eingelesen; bei rund 930 Konten dauert der initiale Durchlauf mit einem persönlichen Riot-Schlüssel erwartungsgemäß ungefähr ein bis zwei Stunden. Aktive Registrierungen und manuell angeforderte Aktualisierungen haben in der Riot-Warteschlange Vorrang.

Der Start protokolliert den Rangrollen-Sweep mit `registeredQueued`, `cleanupQueued`, `pendingPreserved` und `botsIgnored`. Anschließend meldet jeder Riot-Batch `batchSize`, `succeeded` und `failed`. Ein Neustart ist sicher: offene Discord-Operationen sind dedupliziert, und der Sweep kann beliebig oft wiederholt werden.

Updates erfolgen nur bei gestopptem Dienst nach einem verifizierten MongoDB-Backup. Bei Fehlern wird der vorherige Release-Symlink reaktiviert; bei inkompatibler Datenmigration wird zusätzlich das unmittelbar vorher erstellte Backup wiederhergestellt.
