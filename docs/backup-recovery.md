# Backup und Wiederherstellung

`npm run backup:prod` verwendet im Produktions-Release die Online-Backup-Funktion von SQLite und prüft Quelle und Kopie. In einer Entwicklungsinstallation steht zusätzlich `npm run backup` zur Verfügung. `BACKUP_PATH` legt das Ziel fest. Backups erhalten Modus `0600`.

- Täglich sichern und sieben Tagesstände aufbewahren.
- Wöchentlich einen geprüften Stand vier Wochen aufbewahren.
- Mindestens eine verschlüsselte Kopie auf ein anderes Gerät übertragen.
- Vor jeder Drizzle-Migration Dienst und Worker stoppen und ein separates Backup behalten.

## Wiederherstellung

1. Dienst stoppen und beschädigte Datei samt `-wal`/`-shm` nicht überschreiben, sondern zur Analyse wegverschieben.
2. Gewähltes Backup mit `PRAGMA integrity_check` prüfen.
3. Backup als konfigurierte Datenbankdatei mit Modus `0600` kopieren.
4. Passenden Code-Release aktivieren, erforderliche Migrationen ausführen und erneut prüfen.
5. Dienst starten. Durable Migrationen und Operationen werden aus SQLite fortgesetzt.

Eine Wiederherstellungsprobe auf einem separaten Host sollte mindestens vierteljährlich durchgeführt werden.
