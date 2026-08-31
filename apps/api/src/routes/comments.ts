import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { createRequireAuthentication } from "../auth/middleware.js";
import type { AuthService } from "../auth/service.js";
import {
  CommentDeleteForbiddenError,
  CommentNoteNotFoundError,
  CommentNotFoundError,
  CommentParentNotFoundError,
  CommentWorkspaceNotFoundError,
  CommentWriteForbiddenError,
  type CommentService
} from "../comments/service.js";

const noteParamsSchema = z
  .object({ noteId: z.string().uuid(), workspaceId: z.string().uuid() })
  .strict();
const commentParamsSchema = z
  .object({ commentId: z.string().uuid(), noteId: z.string().uuid(), workspaceId: z.string().uuid() })
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
const aesGcmCiphertextSchema = base64Blob(64 * 1024).refine(
  (value) => Buffer.from(value, "base64").length >= 16
);

const createCommentBodySchema = z
  .object({
    contentNonce: aesGcmNonceSchema,
    encryptedContent: aesGcmCiphertextSchema,
    encryptionMetadata: z
      .object({
        algorithm: z.literal("AES-GCM"),
        envelopeVersion: z.union([z.literal(1), z.literal(2)]),
        keyId: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9._:-]+$/)
      })
      .strict(),
    id: z.string().uuid().optional(),
    parentCommentId: z.string().uuid().nullable().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.encryptionMetadata.envelopeVersion === 2 && !value.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Version 2 comment envelopes require a client-selected comment ID."
      });
    }
  });

interface CommentRouteOptions {
  authService: AuthService;
  commentService: CommentService;
}

function validationFailure(reply: FastifyReply) {
  return reply.code(400).send({
    error: { code: "validation_failed", message: "The request is invalid." }
  });
}

function commentFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof CommentWorkspaceNotFoundError) {
    return reply.code(404).send({
      error: { code: "workspace_not_found", message: "Workspace not found." }
    });
  }
  if (error instanceof CommentNoteNotFoundError) {
    return reply.code(404).send({ error: { code: "note_not_found", message: "Note not found." } });
  }
  if (error instanceof CommentParentNotFoundError) {
    return reply.code(404).send({
      error: { code: "parent_comment_not_found", message: "Parent comment not found." }
    });
  }
  if (error instanceof CommentNotFoundError) {
    return reply.code(404).send({
      error: { code: "comment_not_found", message: "Comment not found." }
    });
  }
  if (error instanceof CommentWriteForbiddenError) {
    return reply.code(403).send({
      error: {
        code: "comment_write_forbidden",
        message: "Only workspace owners and editors can create comments."
      }
    });
  }
  if (error instanceof CommentDeleteForbiddenError) {
    return reply.code(403).send({
      error: {
        code: "comment_delete_forbidden",
        message: "Only workspace owners and eligible comment authors can delete comments."
      }
    });
  }
  throw error;
}

export function registerCommentRoutes(app: FastifyInstance, options: CommentRouteOptions): void {
  const { authService, commentService } = options;
  const requireAuthentication = createRequireAuthentication(authService);

  app.post<{ Body: unknown; Params: unknown }>(
    "/api/workspaces/:workspaceId/notes/:noteId/comments",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = noteParamsSchema.safeParse(request.params);
      const body = createCommentBodySchema.safeParse(request.body);
      if (!params.success || !body.success) return validationFailure(reply);
      try {
        const comment = await commentService.createComment(
          params.data.workspaceId,
          params.data.noteId,
          request.authenticatedUser!.id,
          body.data
        );
        return reply.code(201).send({ comment });
      } catch (error) {
        return commentFailure(reply, error);
      }
    }
  );

  app.get<{ Params: unknown }>(
    "/api/workspaces/:workspaceId/notes/:noteId/comments",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = noteParamsSchema.safeParse(request.params);
      if (!params.success) return validationFailure(reply);
      try {
        return {
          comments: await commentService.listComments(
            params.data.workspaceId,
            params.data.noteId,
            request.authenticatedUser!.id
          )
        };
      } catch (error) {
        return commentFailure(reply, error);
      }
    }
  );

  app.delete<{ Params: unknown }>(
    "/api/workspaces/:workspaceId/notes/:noteId/comments/:commentId",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = commentParamsSchema.safeParse(request.params);
      if (!params.success) return validationFailure(reply);
      try {
        await commentService.deleteComment(
          params.data.workspaceId,
          params.data.noteId,
          params.data.commentId,
          request.authenticatedUser!.id
        );
        return reply.code(204).send();
      } catch (error) {
        return commentFailure(reply, error);
      }
    }
  );
}
