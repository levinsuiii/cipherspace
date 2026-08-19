import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthenticatedUser, AuthService } from "./service.js";
import { sessionCookieName } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    authenticatedUser: AuthenticatedUser | null;
  }
}

export function createRequireAuthentication(authService: AuthService) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = request.cookies[sessionCookieName];

    if (!token) {
      await reply.code(401).send({
        error: { code: "unauthorized", message: "Authentication is required." }
      });
      return;
    }

    const user = await authService.authenticate(token);

    if (!user) {
      await reply.code(401).send({
        error: { code: "unauthorized", message: "Authentication is required." }
      });
      return;
    }

    request.authenticatedUser = user;
  };
}
