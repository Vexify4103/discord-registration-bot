# Deployment auf Raspberry Pi

Unterstützt werden Raspberry Pi 4/5 mit 64-Bit Raspberry Pi OS, Node.js 24 LTS und lokalem ext4-Datenträger. SQLite darf nicht auf NFS/SMB liegen.

1. Dienstkonto `discord-registration` ohne Login-Shell anlegen.
2. Release nach `/opt/discord-registration/releases/<version>` kopieren und `npm ci --omit=dev` ausführen. Falls kein ARM64-Prebuild verfügbar ist, vorher `python3`, `make` und `g++` installieren.
3. Datenverzeichnis `/var/lib/discord-registration` mit Modus `0700` anlegen und `DATABASE_PATH=/var/lib/discord-registration/bot.sqlite` setzen.
4. Umgebungsdatei `/etc/discord-registration-bot.env` mit Modus `0600` anlegen. Für unbeaufsichtigten Betrieb einen persönlichen oder produktiven Riot-Schlüssel verwenden.
5. Dienst stoppen, mit `npm run backup:prod` ein Backup erstellen, `npm run db:migrate:prod` ausführen und `PRAGMA integrity_check` prüfen.
6. Symlink `/opt/discord-registration/current` atomar auf das neue Release umstellen.
7. Die mitgelieferte systemd-Unit installieren, `systemctl daemon-reload`, `enable` und `start` ausführen.
8. `journalctl -u discord-registration-bot` auf deutsche Konfigurationsdiagnosen prüfen.

Die Bot-Rolle benötigt zusätzlich **Audit-Log anzeigen**, damit manuelle Nickname-Änderungen ausschließlich dann als Registrierungsänderung übernommen werden, wenn Discord sie einem berechtigten Staff-Mitglied zuordnet.

Für den Discord-Auditkanal im gewünschten Kanal einen eingehenden Webhook erstellen und `BOT_LOG_WEBHOOK_URL` setzen. Die URL ist geheim und darf weder im Repository noch in PM2-Ausgaben erscheinen. Beim Start prüft der Bot, ob der Webhook erreichbar ist und zum konfigurierten Server gehört. Discord begrenzt auch Webhooks; die persistente Outbox sendet deshalb seriell und wiederholt temporär fehlgeschlagene Meldungen automatisch.

Für die League-Erweiterung werden alle `RANK_ROLE_*_ID`-Werte aus `.env.example` mit den bestehenden Discord-Rollen befüllt und anschließend `RANK_ROLE_SYNC_ENABLED=true` gesetzt. Die Unranked-Rolle und alle zehn Rangrollen müssen eindeutige IDs haben; die Bot-Rolle muss über ihnen stehen. Mit `JOIN_ENGAGEMENT_ENABLED=true` erhalten neue, nicht registrierte Mitglieder eine Willkommens-DM. `BOT_MENTION_COMMANDS_ENABLED=true` aktiviert zusätzlich `@Bot ...`-Befehle; dafür muss im Discord Developer Portal unter **Bot → Privileged Gateway Intents** der **Message Content Intent** eingeschaltet sein. `RIOT_SYNC_MIN_DELAY_MS=1250` ist für einen persönlichen Schlüssel mit 100 Anfragen pro zwei Minuten die sichere Mindestkonfiguration.

Nach dem Update in dieser Reihenfolge ausführen:

```bash
pm2 stop GamingCommunity
npm ci
npm run build
npm run db:migrate
npm test
pm2 start GamingCommunity
npx pm2 save
```

Vor `db:migrate` immer `data/bot.sqlite`, `data/bot.sqlite-wal` und `data/bot.sqlite-shm` konsistent sichern oder den vorhandenen Backup-Befehl verwenden. Beim ersten Start werden Rang und Mastery gestaffelt eingelesen; bei rund 930 Konten dauert der initiale Durchlauf mit einem persönlichen Riot-Schlüssel erwartungsgemäß ungefähr ein bis zwei Stunden. Aktive Registrierungen und manuell angeforderte Aktualisierungen haben in der Riot-Warteschlange Vorrang.

Der Start protokolliert den Rangrollen-Sweep mit `registeredQueued`, `cleanupQueued`, `pendingPreserved` und `botsIgnored`. Anschließend meldet jeder Riot-Batch `batchSize`, `succeeded` und `failed`. Ein Neustart ist sicher: offene Discord-Operationen sind dedupliziert, und der Sweep kann beliebig oft wiederholt werden.

Updates erfolgen nur bei gestopptem Dienst nach einem verifizierten Backup. Bei Fehlern wird der vorherige Release-Symlink reaktiviert; bei inkompatibler Migration wird zusätzlich das unmittelbar vorher erstellte Backup wiederhergestellt.
