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

Updates erfolgen nur bei gestopptem Dienst nach einem verifizierten Backup. Bei Fehlern wird der vorherige Release-Symlink reaktiviert; bei inkompatibler Migration wird zusätzlich das unmittelbar vorher erstellte Backup wiederhergestellt.
