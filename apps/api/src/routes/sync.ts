import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { createRequireAuthentication } from "../auth/middleware.js";
import type { AuthService } from "../auth/service.js";
import {
  InvalidSyncCursorError,
  SyncWorkspaceNotFoundError,
  type SyncService
} from "../sync/service.js";

const workspaceParamsSchema = z.object({ workspaceId: z.string().uuid() }).strict();
const pullQuerySchema = z
  .object({ cursor: z.string().min(1).max(1024).optional() })
  .strict();

function base64Blob(maxBytes: number) {
  return z
    .string()
    .min(1)
    .max(Math.ceil(maxBytes / 3) * 4)
    .refine((value) => {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        return false;
      }
      const decoded = Buffer.from(value, "base64");
      return (
        decoded.length > 0 &&
        decoded.length <= maxBytes &&
        decoded.toString("base64") === value
      );
    });
}

const aesGcmNonceSchema = base64Blob(12).refine(
  (value) => Buffer.from(value, "base64").length === 12
);
const aesGcmCiphertextSchema = base64Blob(1024 * 1024).refine(
  (value) => Buffer.from(value, "base64").length >= 16
);

const encryptedPayloadSchema = z
  .object({
    algorithm: z.literal("AES-GCM"),
    ciphertext: aesGcmCiphertextSchema,
    envelopeVersion: z.literal(1),
    keyVersion: z.number().int().positive().max(32_767),
    nonce: aesGcmNonceSchema
  })
  .strict();

const pushChangeSchema = z
  .object({
    baseVersionId: z.string().uuid().nullable(),
    clientRevision: z.number().int().positive(),
    createdAtClient: z.string().datetime({ offset: true }),
    encryptedPayload: encryptedPayloadSchema.nullable(),
    noteId: z.string().uuid(),
    operationId: z.string().uuid(),
    operationType: z.enum(["create_note", "update_note", "delete_note"])
  })
  .strict()
  .superRefine((change, context) => {
    if (change.operationType === "create_note" && change.baseVersionId !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Creates cannot have a base version." });
    }
    if (change.operationType !== "create_note" && change.baseVersionId === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Updates and deletes require a base version." });
    }
    if (change.operationType === "delete_note" && change.encryptedPayload !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Deletes cannot include a payload." });
    }
    if (change.operationType !== "delete_note" && change.encryptedPayload === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Creates and updates require a payload." });
    }
  });

const pushBodySchema = z
  .object({
    changes: z.array(pushChangeSchema).min(1).max(100),
    clientId: z.string().uuid()
  })
  .strict();

interface SyncRouteOptions {
  authService: AuthService;
  syncService: SyncService;
}

function validationFailure(reply: FastifyReply) {
  return reply.code(400).send({
    error: { code: "validation_failed", message: "The request is invalid." }
  });
}

function syncFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof SyncWorkspaceNotFoundError) {
    return reply.code(404).send({
      error: { code: "workspace_not_found", message: "Workspace not found." }
    });
  }
  if (error instanceof InvalidSyncCursorError) {
    return reply.code(400).send({
      error: { code: "invalid_sync_cursor", message: "The sync cursor is invalid." }
    });
  }
  throw error;
}

export function registerSyncRoutes(app: FastifyInstance, options: SyncRouteOptions): void {
  const requireAuthentication = createRequireAuthentication(options.authService);

  app.post<{ Body: unknown; Params: unknown }>(
    "/api/workspaces/:workspaceId/sync/push",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = workspaceParamsSchema.safeParse(request.params);
      const body = pushBodySchema.safeParse(request.body);
      if (!params.success || !body.success) return validationFailure(reply);
      try {
        return await options.syncService.push(
          params.data.workspaceId,
          request.authenticatedUser!.id,
          body.data
        );
      } catch (error) {
        return syncFailure(reply, error);
      }
    }
  );

  app.get<{ Params: unknown; Querystring: unknown }>(
    "/api/workspaces/:workspaceId/sync/pull",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = workspaceParamsSchema.safeParse(request.params);
      const query = pullQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) return validationFailure(reply);
      try {
        return await options.syncService.pull(
          params.data.workspaceId,
          request.authenticatedUser!.id,
          query.data.cursor ?? null
        );
      } catch (error) {
        return syncFailure(reply, error);
      }
    }
  );
}
