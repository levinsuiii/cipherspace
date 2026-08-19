import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";

import { PostgresAuthRepository, type AuthRepository } from "./auth/repository.js";
import { AuthService } from "./auth/service.js";
import { loadConfig, type AppConfig } from "./config.js";
import { createDatabase, type Database } from "./database/database.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import {
  PostgresWorkspaceRepository,
  type WorkspaceRepository
} from "./workspaces/repository.js";
import { WorkspaceService } from "./workspaces/service.js";

export interface BuildAppOptions {
  config?: AppConfig;
  database?: Database;
  authRepository?: AuthRepository;
  workspaceRepository?: WorkspaceRepository;
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
  const authRepository = options.authRepository ?? new PostgresAuthRepository(database);
  const workspaceRepository =
    options.workspaceRepository ?? new PostgresWorkspaceRepository(database);
  const authService = new AuthService(
    authRepository,
    config.SESSION_SECRET,
    config.SESSION_TTL_HOURS
  );
  const workspaceService = new WorkspaceService(workspaceRepository);

  app.register(cookie);
  app.decorateRequest("authenticatedUser", null);
  registerHealthRoute(app, database);
  registerAuthRoutes(app, {
    authService,
    secureCookies: config.NODE_ENV === "production"
  });
  registerWorkspaceRoutes(app, { authService, workspaceService });

  if (ownsDatabase) {
    app.addHook("onClose", async () => {
      await database.close();
    });
  }

  return app;
}
