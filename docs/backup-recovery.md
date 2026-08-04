# Backup und Wiederherstellung

MongoDB ist die produktive Quelle der Wahrheit. Ein Backup muss deshalb ein konsistenter `mongodump` der Datenbank `gaming_community` sein. Die Backup-Funktion des Hosting-Anbieters kann zusätzlich verwendet werden, ersetzt aber keine regelmäßig geprüfte, unabhängige Kopie.

- Täglich sichern und sieben Tagesstände aufbewahren.
- Wöchentlich einen geprüften Stand vier Wochen aufbewahren.
- Mindestens eine verschlüsselte Kopie auf ein anderes Gerät übertragen.
- Mastery-Verlaufsdaten werden durch MongoDB nach `MASTERY_HISTORY_RETENTION_DAYS` automatisch entfernt; Standard sind 730 Tage.
- Zugangsdaten nicht als Klartext in Shell-Historie, Prozessliste oder Backup-Skripte schreiben. Für `mongodump` eine nur für den Dienst lesbare Konfigurationsdatei oder die Backup-Funktion des Providers verwenden.

Die bisherige SQLite-Datei bleibt nach der Umstellung als unveränderte Rückfallkopie erhalten. `npm run backup` beziehungsweise `npm run backup:prod` sichern nur diese alte SQLite-Quelle; sie sind kein Backup der laufenden MongoDB.

## Wiederherstellung

1. Bot und Worker stoppen.
2. Den gewählten Dump in eine separate Testdatenbank zurückspielen.
3. Dokumentzahlen, Indizes und stichprobenartig Registrierungen, offene Operationen und Mastery-Daten prüfen.
4. Erst danach die produktive Datenbank wiederherstellen oder die Anwendung auf die geprüfte Datenbank umstellen.
5. Bot starten und Logs auf `MongoDB persistence ready`, Discord-Diagnosen und wiederaufgenommene Operationen prüfen.

Eine Wiederherstellungsprobe auf einem separaten Host sollte mindestens vierteljährlich durchgeführt werden. Die öffentliche MongoDB-Schnittstelle sollte per Firewall ausschließlich für die Pi-Adresse erreichbar sein oder über ein privates Netz wie Tailscale laufen; ohne TLS dürfen Zugangsdaten und personenbezogene Daten nicht über ein ungeschütztes Netz übertragen werden.
