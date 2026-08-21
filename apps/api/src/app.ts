import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";

import { PostgresAuthRepository, type AuthRepository } from "./auth/repository.js";
import { AuthService } from "./auth/service.js";
import { loadConfig, type AppConfig } from "./config.js";
import { PostgresCommentRepository, type CommentRepository } from "./comments/repository.js";
import { CommentService } from "./comments/service.js";
import { createDatabase, type Database } from "./database/database.js";
import { PostgresIdentityRepository, type IdentityRepository } from "./identities/repository.js";
import { IdentityService } from "./identities/service.js";
import { PostgresNoteRepository, type NoteRepository } from "./notes/repository.js";
import { NoteService } from "./notes/service.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCommentRoutes } from "./routes/comments.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerIdentityRoutes } from "./routes/identities.js";
import { registerNoteRoutes } from "./routes/notes.js";
import { registerSyncRoutes } from "./routes/sync.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import { PostgresSyncRepository, type SyncRepository } from "./sync/repository.js";
import { SyncService } from "./sync/service.js";
import {
  PostgresWorkspaceRepository,
  type WorkspaceRepository
} from "./workspaces/repository.js";
import { WorkspaceService } from "./workspaces/service.js";

export interface BuildAppOptions {
  config?: AppConfig;
  database?: Database;
  identityRepository?: IdentityRepository;
  authRepository?: AuthRepository;
  commentRepository?: CommentRepository;
  noteRepository?: NoteRepository;
  syncRepository?: SyncRepository;
  workspaceRepository?: WorkspaceRepository;
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    bodyLimit: config.REQUEST_BODY_LIMIT_BYTES,
    trustProxy: config.TRUST_PROXY,
    logger:
      options.logger === false || (options.logger === undefined && config.NODE_ENV === "test")
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: {
              censor: "[Redacted]",
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "res.headers.set-cookie"
              ]
            }
          }
  });
  const database =
    options.database ?? createDatabase(config.DATABASE_URL, config.DATABASE_POOL_MAX);
  const ownsDatabase = options.database === undefined;
  const authRepository = options.authRepository ?? new PostgresAuthRepository(database);
  const identityRepository = options.identityRepository ?? new PostgresIdentityRepository(database);
  const commentRepository = options.commentRepository ?? new PostgresCommentRepository(database);
  const workspaceRepository =
    options.workspaceRepository ?? new PostgresWorkspaceRepository(database);
  const noteRepository = options.noteRepository ?? new PostgresNoteRepository(database);
  const syncRepository = options.syncRepository ?? new PostgresSyncRepository(database);
  const authService = new AuthService(
    authRepository,
    config.SESSION_SECRET,
    config.SESSION_TTL_HOURS
  );
  const identityService = new IdentityService(identityRepository);
  const commentService = new CommentService(commentRepository, workspaceRepository);
  const workspaceService = new WorkspaceService(workspaceRepository, identityRepository);
  const noteService = new NoteService(noteRepository, workspaceRepository);
  const syncService = new SyncService(syncRepository, workspaceRepository);

  app.register(cookie);
  app.register(cors, {
    allowedHeaders: ["Content-Type"],
    credentials: true,
    maxAge: 600,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    origin: config.CORS_ORIGINS.length > 0 ? config.CORS_ORIGINS : false,
    strictPreflight: true
  });
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        baseUri: ["'none'"],
        defaultSrc: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    hsts:
      config.NODE_ENV === "production"
        ? { includeSubDomains: true, maxAge: 31_536_000 }
        : false,
    referrerPolicy: { policy: "no-referrer" }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/")) {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
    }
    return payload;
  });
  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({
      error: { code: "not_found", message: "The requested resource was not found." }
    })
  );
  app.setErrorHandler(async (error, request, reply) => {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    if (statusCode === 413) {
      return reply.code(413).send({
        error: { code: "request_too_large", message: "The request body is too large." }
      });
    }
    if (statusCode === 429) {
      return reply.code(429).send({
        error: {
          code: "rate_limit_exceeded",
          message: "Too many authentication attempts. Try again later."
        }
      });
    }
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: { code: "invalid_request", message: "The request could not be processed." }
      });
    }

    request.log.error(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        method: request.method,
        requestId: request.id,
        route: request.routeOptions.url
      },
      "Request failed"
    );
    return reply.code(500).send({
      error: { code: "internal_error", message: "An unexpected error occurred." }
    });
  });
  app.decorateRequest("authenticatedUser", null);
  registerHealthRoute(app, database);
  app.register(async (authApp) => {
    await authApp.register(rateLimit, {
      global: false,
      max: config.AUTH_RATE_LIMIT_MAX,
      timeWindow: config.AUTH_RATE_LIMIT_WINDOW_MS
    });
    registerAuthRoutes(authApp, {
      rateLimitMax: config.AUTH_RATE_LIMIT_MAX,
      rateLimitWindowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
      authService,
      sameSite: config.SESSION_COOKIE_SAME_SITE,
      secureCookies: config.NODE_ENV === "production"
    });
  });
  registerCommentRoutes(app, { authService, commentService });
  registerIdentityRoutes(app, { authService, identityService });
  registerNoteRoutes(app, { authService, noteService });
  registerSyncRoutes(app, { authService, syncService });
  registerWorkspaceRoutes(app, { authService, workspaceService });

  if (ownsDatabase) {
    app.addHook("onClose", async () => {
      await database.close();
    });
  }

  return app;
}
