import { BotApplication } from "./app.js";
import { loadConfig } from "./config/load.js";
import { createLogger } from "./logging/logger.js";

const config = loadConfig();
const logger = createLogger(config);
const app = new BotApplication(config, logger);

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void app.stop(signal).finally(() => process.exit(0)));
process.on("unhandledRejection", (error) => logger.error({ err: error }, "Unhandled rejection"));
process.on("uncaughtException", (error) => {
	logger.fatal({ err: error }, "Uncaught exception");
	void app.stop("uncaughtException").finally(() => process.exit(1));
});

app.start().catch((error) => {
	logger.fatal({ err: error }, "Startup failed");
	void app.stop("startupFailure").finally(() => process.exit(1));
});
