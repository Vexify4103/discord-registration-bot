import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { loadConfig } from "../config/load.js";
import { assertDatabaseHealthy, createDatabase } from "./client.js";

const config = loadConfig();
const context = createDatabase(config.DATABASE_PATH);
try {
	migrate(context.db, { migrationsFolder: "./src/database/migrations" });
	assertDatabaseHealthy(context);
	console.log("Datenbankmigration erfolgreich.");
} finally {
	context.sqlite.close();
}
