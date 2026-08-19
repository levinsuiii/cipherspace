import type { FastifyInstance } from "fastify";

import type { Database } from "../database/database.js";

export function registerHealthRoute(app: FastifyInstance, database: Database): void {
  app.get("/health", async (_request, reply) => {
    try {
      await database.query("SELECT 1");
      return { database: "reachable", status: "ok" };
    } catch (error) {
      app.log.error({ err: error }, "Database health check failed");
      return reply.code(503).send({ database: "unreachable", status: "error" });
    }
  });
}
