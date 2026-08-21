import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { createRequireAuthentication } from "../auth/middleware.js";
import type { AuthService } from "../auth/service.js";
import {
  NoteDeleteForbiddenError,
  NoteNotFoundError,
  NoteWorkspaceNotFoundError,
  NoteWriteForbiddenError,
  type NoteService
} from "../notes/service.js";

const noteParamsSchema = z
  .object({ noteId: z.string().uuid(), workspaceId: z.string().uuid() })
  .strict();
const workspaceParamsSchema = z.object({ workspaceId: z.string().uuid() }).strict();

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

function aesGcmCiphertext(maxBytes: number) {
  return base64Blob(maxBytes).refine(
    (value) => Buffer.from(value, "base64").length >= 16
  );
}

const encryptionMetadataSchema = z
  .object({
    algorithm: z.literal("AES-GCM"),
    envelopeVersion: z.literal(1),
    keyId: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9._:-]+$/)
  })
  .strict();

const versionBodyShape = {
  clientVersion: z.string().trim().min(1).max(255).nullable().optional(),
  contentNonce: aesGcmNonceSchema,
  encryptedContent: aesGcmCiphertext(1024 * 1024),
  encryptionMetadata: encryptionMetadataSchema
};
const versionBodySchema = z.object(versionBodyShape).strict();
const createNoteBodySchema = z
  .object({
    ...versionBodyShape,
    encryptedTitle: aesGcmCiphertext(16 * 1024).nullable().optional(),
    encryptedTitleNonce: aesGcmNonceSchema.nullable().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const hasTitle = typeof value.encryptedTitle === "string";
    const hasNonce = typeof value.encryptedTitleNonce === "string";
    if (hasTitle !== hasNonce) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Encrypted title and nonce must be supplied together."
      });
    }
  });

interface NoteRouteOptions {
  authService: AuthService;
  noteService: NoteService;
}

function validationFailure(reply: FastifyReply) {
  return reply.code(400).send({
    error: { code: "validation_failed", message: "The request is invalid." }
  });
}

function noteFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof NoteWorkspaceNotFoundError) {
    return reply.code(404).send({
      error: { code: "workspace_not_found", message: "Workspace not found." }
    });
  }
  if (error instanceof NoteNotFoundError) {
    return reply.code(404).send({
      error: { code: "note_not_found", message: "Note not found." }
    });
  }
  if (error instanceof NoteWriteForbiddenError) {
    return reply.code(403).send({
      error: {
        code: "note_write_forbidden",
        message: "Only workspace owners and editors can create or update notes."
      }
    });
  }
  if (error instanceof NoteDeleteForbiddenError) {
    return reply.code(403).send({
      error: { code: "note_delete_forbidden", message: "Only workspace owners can delete notes." }
    });
  }
  throw error;
}

export function registerNoteRoutes(app: FastifyInstance, options: NoteRouteOptions): void {
  const { authService, noteService } = options;
  const requireAuthentication = createRequireAuthentication(authService);

  app.post<{ Body: unknown; Params: unknown }>(
    "/api/workspaces/:workspaceId/notes",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = workspaceParamsSchema.safeParse(request.params);
      const body = createNoteBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return validationFailure(reply);
      }
      try {
        const detail = await noteService.createNote(
          params.data.workspaceId,
          request.authenticatedUser!.id,
          body.data
        );
        return reply.code(201).send(detail);
      } catch (error) {
        return noteFailure(reply, error);
      }
    }
  );

  app.get<{ Params: unknown }>(
    "/api/workspaces/:workspaceId/notes",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = workspaceParamsSchema.safeParse(request.params);
      if (!params.success) {
        return validationFailure(reply);
      }
      try {
        return {
          notes: await noteService.listNotes(
            params.data.workspaceId,
            request.authenticatedUser!.id
          )
        };
      } catch (error) {
        return noteFailure(reply, error);
      }
    }
  );

  app.get<{ Params: unknown }>(
    "/api/workspaces/:workspaceId/notes/:noteId",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = noteParamsSchema.safeParse(request.params);
      if (!params.success) {
        return validationFailure(reply);
      }
      try {
        return await noteService.getNote(
          params.data.workspaceId,
          params.data.noteId,
          request.authenticatedUser!.id
        );
      } catch (error) {
        return noteFailure(reply, error);
      }
    }
  );

  app.post<{ Body: unknown; Params: unknown }>(
    "/api/workspaces/:workspaceId/notes/:noteId/versions",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = noteParamsSchema.safeParse(request.params);
      const body = versionBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return validationFailure(reply);
      }
      try {
        const version = await noteService.appendVersion(
          params.data.workspaceId,
          params.data.noteId,
          request.authenticatedUser!.id,
          body.data
        );
        return reply.code(201).send({ version });
      } catch (error) {
        return noteFailure(reply, error);
      }
    }
  );

  app.get<{ Params: unknown }>(
    "/api/workspaces/:workspaceId/notes/:noteId/versions",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = noteParamsSchema.safeParse(request.params);
      if (!params.success) {
        return validationFailure(reply);
      }
      try {
        return {
          versions: await noteService.listVersions(
            params.data.workspaceId,
            params.data.noteId,
            request.authenticatedUser!.id
          )
        };
      } catch (error) {
        return noteFailure(reply, error);
      }
    }
  );

  app.delete<{ Params: unknown }>(
    "/api/workspaces/:workspaceId/notes/:noteId",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = noteParamsSchema.safeParse(request.params);
      if (!params.success) {
        return validationFailure(reply);
      }
      try {
        await noteService.deleteNote(
          params.data.workspaceId,
          params.data.noteId,
          request.authenticatedUser!.id
        );
        return reply.code(204).send();
      } catch (error) {
        return noteFailure(reply, error);
      }
    }
  );
}
