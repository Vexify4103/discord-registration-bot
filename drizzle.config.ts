import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	schema: "./src/database/schema/index.ts",
	out: "./src/database/migrations",
	dbCredentials: { url: process.env.SQLITE_IMPORT_PATH ?? "./data/bot.sqlite" },
});
