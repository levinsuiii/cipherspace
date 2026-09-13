import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { canonicalEmailSchema } from "../auth/email.js";
import { createRequireAuthentication } from "../auth/middleware.js";
import {
  AuthService,
  InvalidCredentialsError,
  InvalidEmailVerificationError,
  RegistrationClosedError,
  type AuthenticatedSession
} from "../auth/service.js";
import { sessionCookieName } from "../auth/session.js";

const credentialsSchema = z
  .object({
    email: canonicalEmailSchema,
    password: z.string().min(12).max(128)
  })
  .strict();
const verificationTokenSchema = z
  .object({
    password: z.string().min(12).max(128),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
  })
  .strict();

interface AuthRouteOptions {
  authService: AuthService;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  sameSite: "strict" | "lax" | "none";
  secureCookies: boolean;
}

const cookieBaseOptions = {
  httpOnly: true,
  path: "/",
  priority: "high" as const
};

function setSessionCookie(
  reply: FastifyReply,
  session: AuthenticatedSession,
  sameSite: AuthRouteOptions["sameSite"],
  secureCookies: boolean
): void {
  reply.setCookie(sessionCookieName, session.token, {
    ...cookieBaseOptions,
    expires: session.expiresAt,
    sameSite,
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
  const { authService, rateLimitMax, rateLimitWindowMs, sameSite, secureCookies } = options;
  const requireAuthentication = createRequireAuthentication(authService);
  const authRateLimit = {
    max: rateLimitMax,
    timeWindow: rateLimitWindowMs,
    groupId: "authentication"
  };
  const verificationResendRateLimit = {
    groupId: "email-verification-resend",
    max: Math.min(3, rateLimitMax),
    timeWindow: Math.max(60_000, rateLimitWindowMs)
  };

  app.post<{ Body: unknown }>(
    "/api/auth/register",
    { bodyLimit: 4_096, config: { rateLimit: authRateLimit } },
    async (request, reply) => {
      const credentials = credentialsSchema.safeParse(request.body);

      if (!credentials.success) {
        return validationFailure(reply);
      }

      let session: AuthenticatedSession | null;
      try {
        session = await authService.register(credentials.data.email, credentials.data.password);
      } catch (error) {
        if (error instanceof RegistrationClosedError) {
          return reply.code(403).send({
            error: {
              code: "registration_closed",
              message: "CipherSpace befindet sich derzeit in einer geschlossenen Beta. Registrierungen sind nur für eingeladene Tester möglich."
            }
          });
        }
        throw error;
      }
      if (!session) {
        return reply.code(202).send({
          message: "If this address can be registered, verification instructions will be sent.",
          verificationPending: true
        });
      }
      setSessionCookie(reply, session, sameSite, secureCookies);
      return reply.code(201).send({ user: session.user });
    }
  );

  app.post(
    "/api/auth/email-verification/request",
    { config: { rateLimit: verificationResendRateLimit }, preHandler: requireAuthentication },
    async (request, reply) => {
      await authService.requestEmailVerification(
        request.authenticatedUser!.id,
        request.authenticatedUser!.email
      );
      return reply.code(202).send({
        message: "If verification is available, instructions will be sent."
      });
    }
  );

  app.post<{ Body: unknown }>(
    "/api/auth/email-verification/confirm",
    { bodyLimit: 1_024, config: { rateLimit: authRateLimit } },
    async (request, reply) => {
      const body = verificationTokenSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: { code: "verification_failed", message: "The verification token is invalid or expired." }
        });
      }
      try {
        return {
          user: await authService.confirmEmailVerification(body.data.token, body.data.password)
        };
      } catch (error) {
        if (error instanceof InvalidEmailVerificationError) {
          return reply.code(400).send({
            error: { code: "verification_failed", message: "The verification token is invalid or expired." }
          });
        }
        throw error;
      }
    }
  );

  app.post<{ Body: unknown }>(
    "/api/auth/login",
    { bodyLimit: 4_096, config: { rateLimit: authRateLimit } },
    async (request, reply) => {
      const credentials = credentialsSchema.safeParse(request.body);

      if (!credentials.success) {
        return validationFailure(reply);
      }

      try {
        const session = await authService.login(credentials.data.email, credentials.data.password);
        setSessionCookie(reply, session, sameSite, secureCookies);
        return { user: session.user };
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          return reply.code(401).send({
            error: { code: "invalid_credentials", message: "Invalid email or password." }
          });
        }

        throw error;
      }
    }
  );

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
      sameSite,
      secure: secureCookies
    });
    return reply.code(204).send();
  });
}
