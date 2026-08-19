import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { createRequireAuthentication } from "../auth/middleware.js";
import {
  AuthService,
  DuplicateAccountError,
  InvalidCredentialsError,
  type AuthenticatedSession
} from "../auth/service.js";
import { sessionCookieName } from "../auth/session.js";

const credentialsSchema = z
  .object({
    email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
    password: z.string().min(12).max(128)
  })
  .strict();

interface AuthRouteOptions {
  authService: AuthService;
  secureCookies: boolean;
}

const cookieBaseOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const
};

function setSessionCookie(
  reply: FastifyReply,
  session: AuthenticatedSession,
  secureCookies: boolean
): void {
  reply.setCookie(sessionCookieName, session.token, {
    ...cookieBaseOptions,
    expires: session.expiresAt,
    secure: secureCookies
  });
}

function validationFailure(reply: FastifyReply) {
  return reply.code(400).send({
    error: {
      code: "validation_failed",
      message: "A valid email and a password between 12 and 128 characters are required."
    }
  });
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { authService, secureCookies } = options;
  const requireAuthentication = createRequireAuthentication(authService);

  app.post<{ Body: unknown }>("/api/auth/register", async (request, reply) => {
    const credentials = credentialsSchema.safeParse(request.body);

    if (!credentials.success) {
      return validationFailure(reply);
    }

    try {
      const session = await authService.register(
        credentials.data.email,
        credentials.data.password
      );
      setSessionCookie(reply, session, secureCookies);
      return reply.code(201).send({ user: session.user });
    } catch (error) {
      if (error instanceof DuplicateAccountError) {
        return reply.code(409).send({
          error: {
            code: "account_creation_failed",
            message: "Unable to create an account with those credentials."
          }
        });
      }

      throw error;
    }
  });

  app.post<{ Body: unknown }>("/api/auth/login", async (request, reply) => {
    const credentials = credentialsSchema.safeParse(request.body);

    if (!credentials.success) {
      return validationFailure(reply);
    }

    try {
      const session = await authService.login(credentials.data.email, credentials.data.password);
      setSessionCookie(reply, session, secureCookies);
      return { user: session.user };
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return reply.code(401).send({
          error: { code: "invalid_credentials", message: "Invalid email or password." }
        });
      }

      throw error;
    }
  });

  app.get(
    "/api/auth/me",
    { preHandler: requireAuthentication },
    async (request) => ({ user: request.authenticatedUser })
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[sessionCookieName];

    if (token) {
      await authService.logout(token);
    }

    reply.clearCookie(sessionCookieName, {
      ...cookieBaseOptions,
      secure: secureCookies
    });
    return reply.code(204).send();
  });
}
