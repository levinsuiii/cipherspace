import { z } from "zod";

import type { SyncPullResponse, SyncPushResponse } from "../api/types";

function base64Blob(minBytes: number, maxBytes: number) {
  return z
    .string()
    .min(1)
    .max(Math.ceil(maxBytes / 3) * 4)
    .refine((value) => {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        return false;
      }
      try {
        const length = atob(value).length;
        return length >= minBytes && length <= maxBytes;
      } catch {
        return false;
      }
    });
}

const encryptionMetadataSchema = z
  .object({
    algorithm: z.string().min(1),
    envelopeVersion: z.number().int().positive(),
    keyId: z.string().min(1)
  })
  .strict();

const noteSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    createdBy: z.string().uuid(),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
    encryptedTitle: base64Blob(1, 16 * 1024).nullable(),
    encryptedTitleNonce: base64Blob(1, 256).nullable(),
    id: z.string().uuid(),
    latestVersionId: z.string().uuid(),
    updatedAt: z.string().datetime({ offset: true }),
    workspaceId: z.string().uuid()
  })
  .strict()
  .superRefine((note, context) => {
    if ((note.encryptedTitle === null) !== (note.encryptedTitleNonce === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Encrypted title and nonce must be supplied together."
      });
    }
  });

const versionSchema = z
  .object({
    clientVersion: z.string().nullable(),
    contentNonce: base64Blob(12, 12),
    createdAt: z.string().datetime({ offset: true }),
    createdBy: z.string().uuid(),
    encryptedContent: base64Blob(16, 1024 * 1024),
    encryptionMetadata: encryptionMetadataSchema,
    id: z.string().uuid(),
    noteId: z.string().uuid(),
    parentVersionId: z.string().uuid().nullable(),
    versionNumber: z.number().int().positive()
  })
  .strict();

const acceptedResultSchema = z
  .object({
    note: noteSchema,
    operationId: z.string().uuid(),
    status: z.literal("accepted"),
    version: versionSchema
  })
  .strict();

const conflictResultSchema = z
  .object({
    note: noteSchema,
    operationId: z.string().uuid(),
    remoteVersion: versionSchema,
    status: z.literal("conflict")
  })
  .strict();

const duplicateAcceptedSchema = z
  .object({
    note: noteSchema,
    operationId: z.string().uuid(),
    originalStatus: z.literal("accepted"),
    status: z.literal("duplicate"),
    version: versionSchema
  })
  .strict();

const duplicateConflictSchema = z
  .object({
    note: noteSchema,
    operationId: z.string().uuid(),
    originalStatus: z.literal("conflict"),
    remoteVersion: versionSchema,
    status: z.literal("duplicate")
  })
  .strict();

const rejectedResultSchema = z
  .object({
    errorCode: z.enum(["idempotency_key_reused", "note_not_found", "write_forbidden"]),
    operationId: z.string().uuid(),
    status: z.literal("rejected")
  })
  .strict();

const pushResponseSchema = z
  .object({
    results: z.array(
      z.union([
        acceptedResultSchema,
        conflictResultSchema,
        duplicateAcceptedSchema,
        duplicateConflictSchema,
        rejectedResultSchema
      ])
    ),
    workspaceId: z.string().uuid()
  })
  .strict();

const pullResponseSchema = z
  .object({
    changes: z.array(
      z
        .object({
          changeId: z.string().uuid(),
          note: noteSchema,
          operationType: z.enum(["delete_note", "upsert_note_version"]),
          version: versionSchema
        })
        .strict()
    ),
    hasMore: z.boolean(),
    nextCursor: z.string().min(1).max(1024),
    workspaceId: z.string().uuid()
  })
  .strict()
  .superRefine((response, context) => {
    for (const [index, change] of response.changes.entries()) {
      if (
        change.note.workspaceId !== response.workspaceId ||
        change.version.noteId !== change.note.id
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A pulled change has inconsistent workspace or note identifiers.",
          path: ["changes", index]
        });
      }
    }
  });

export function parseSyncPushResponse(value: unknown): SyncPushResponse {
  return pushResponseSchema.parse(value) as SyncPushResponse;
}

export function parseSyncPullResponse(value: unknown): SyncPullResponse {
  return pullResponseSchema.parse(value) as SyncPullResponse;
}
