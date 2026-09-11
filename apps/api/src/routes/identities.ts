import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { createRequireAuthentication } from "../auth/middleware.js";
import type { AuthService } from "../auth/service.js";
import { userIdentityAlgorithm, userSigningAlgorithm } from "../identities/repository.js";
import {
  IdentityNotFoundError,
  IdentityVersionConflictError,
  InvalidIdentityPublicKeyError,
  type IdentityService
} from "../identities/service.js";

const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const hexSha256 = z.string().regex(/^[0-9a-f]{64}$/);
const identitySchema = z
  .object({
    bundleHash: hexSha256,
    bundleSequence: z.number().int().min(1).max(32_767),
    bundleVersion: z.literal(1),
    createdAt: z.string().datetime({ offset: false }),
    encryptionKey: z.object({
      algorithm: z.literal(userIdentityAlgorithm),
      fingerprint: hexSha256,
      keyVersion: z.number().int().min(1).max(32_767),
      publicKey: z.string().min(1).max(2_048).regex(canonicalBase64)
    }).strict(),
    previousBundleHash: hexSha256.nullable(),
    signature: z.object({
      algorithm: z.literal(userSigningAlgorithm),
      value: z.string().min(1).max(256).regex(canonicalBase64)
    }).strict(),
    signingKey: z.object({
      algorithm: z.literal(userSigningAlgorithm),
      fingerprint: hexSha256,
      keyVersion: z.literal(1),
      publicKey: z.string().min(1).max(512).regex(canonicalBase64)
    }).strict(),
    userId: z.string().uuid()
  })
  .strict()
  .refine((bundle) => (bundle.bundleSequence === 1) === (bundle.previousBundleHash === null));

function identityFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof IdentityNotFoundError) {
    return reply.code(404).send({
      error: { code: "identity_not_found", message: "No encryption identity is registered." }
    });
  }
  if (error instanceof InvalidIdentityPublicKeyError) {
    return reply.code(400).send({
      error: { code: "invalid_identity_key", message: "The public encryption key is invalid." }
    });
  }
  if (error instanceof IdentityVersionConflictError) {
    return reply.code(409).send({
      error: {
        code: "identity_version_conflict",
        message: "The identity key version conflicts with the registered identity."
      }
    });
  }
  throw error;
}

export function registerIdentityRoutes(
  app: FastifyInstance,
  options: { authService: AuthService; identityService: IdentityService }
): void {
  const requireAuthentication = createRequireAuthentication(options.authService);

  app.get(
    "/api/crypto/identity",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      try {
        return { identity: await options.identityService.getCurrent(request.authenticatedUser!.id) };
      } catch (error) {
        return identityFailure(reply, error);
      }
    }
  );

  app.put<{ Body: unknown }>(
    "/api/crypto/identity",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const body = identitySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: { code: "validation_failed", message: "The identity key is invalid." }
        });
      }
      try {
        if (body.data.userId !== request.authenticatedUser!.id) {
          return reply.code(400).send({
            error: { code: "validation_failed", message: "The identity bundle user is invalid." }
          });
        }
        const result = await options.identityService.register(body.data);
        return reply.code(result.created ? 201 : 200).send({ identity: result.identity });
      } catch (error) {
        return identityFailure(reply, error);
      }
    }
  );
}
