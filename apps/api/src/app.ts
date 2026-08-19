import Fastify, { type FastifyInstance } from "fastify";

import { loadConfig, type AppConfig } from "./config.js";
import { createDatabase, type Database } from "./database/database.js";
import { registerHealthRoute } from "./routes/health.js";

export interface BuildAppOptions {
  config?: AppConfig;
  database?: Database;
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger:
      options.logger === false || (options.logger === undefined && config.NODE_ENV === "test")
        ? false
        : { level: config.LOG_LEVEL }
  });
  const database = options.database ?? createDatabase(config.DATABASE_URL);
  const ownsDatabase = options.database === undefined;

  registerHealthRoute(app, database);

  if (ownsDatabase) {
    app.addHook("onClose", async () => {
      await database.close();
    });
  }

  return app;
}
