import {
  LEGACY_CONTENT_ENVELOPE_VERSION,
  NOTE_ENCRYPTION_ALGORITHM,
  NOTE_ENVELOPE_VERSION,
  WORKSPACE_KEY_VERSION
} from "./constants.js";
import { CipherSpaceCryptoError } from "./errors.js";
import type { CommentEncryptionContext, NoteEncryptionContext } from "./types.js";

const textEncoder = new TextEncoder();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function assertUuid(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new CipherSpaceCryptoError(
      "invalid_payload",
      `${fieldName} must be a canonical lowercase UUID.`
    );
  }
}

function assertNoteContext(context: unknown): asserts context is NoteEncryptionContext {
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw new CipherSpaceCryptoError(
      "invalid_payload",
      "Version 2 note envelopes require note encryption metadata."
    );
  }
  const record = context as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "localRevision,noteId,workspaceId") {
    throw new CipherSpaceCryptoError(
      "invalid_payload",
      "Version 2 note encryption metadata contains missing or unsupported fields."
    );
  }
  assertUuid(record.workspaceId, "workspaceId");
  assertUuid(record.noteId, "noteId");
  if (!Number.isSafeInteger(record.localRevision) || (record.localRevision as number) < 1) {
    throw new CipherSpaceCryptoError(
      "invalid_payload",
      "localRevision must be a positive safe integer."
    );
  }
}

function assertCommentContext(context: unknown): asserts context is CommentEncryptionContext {
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw new CipherSpaceCryptoError(
      "invalid_payload",
      "Version 2 comment envelopes require comment encryption metadata."
    );
  }
  const record = context as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
    "authorId,commentId,noteId,parentCommentId,workspaceId"
  ) {
    throw new CipherSpaceCryptoError(
      "invalid_payload",
      "Version 2 comment encryption metadata contains missing or unsupported fields."
    );
  }
  assertUuid(record.workspaceId, "workspaceId");
  assertUuid(record.noteId, "noteId");
  assertUuid(record.commentId, "commentId");
  assertUuid(record.authorId, "authorId");
  if (record.parentCommentId !== null) {
    assertUuid(record.parentCommentId, "parentCommentId");
  }
}

function encodeUtf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(textEncoder.encode(value));
}

function encodeCanonicalFields(
  fields: readonly (number | string | null)[]
): Uint8Array<ArrayBuffer> {
  return encodeUtf8(JSON.stringify(fields));
}

export function noteAdditionalData(
  envelopeVersion: number,
  context?: NoteEncryptionContext
): Uint8Array<ArrayBuffer> {
  if (envelopeVersion === LEGACY_CONTENT_ENVELOPE_VERSION) {
    return encodeUtf8(
      `cipherspace.note|${LEGACY_CONTENT_ENVELOPE_VERSION}|${NOTE_ENCRYPTION_ALGORITHM}|${WORKSPACE_KEY_VERSION}`
    );
  }
  if (envelopeVersion !== NOTE_ENVELOPE_VERSION) {
    throw new CipherSpaceCryptoError("invalid_payload", "Unsupported note envelope version.");
  }
  assertNoteContext(context);
  return encodeCanonicalFields([
    "cipherspace.note",
    NOTE_ENVELOPE_VERSION,
    NOTE_ENCRYPTION_ALGORITHM,
    WORKSPACE_KEY_VERSION,
    context.workspaceId,
    context.noteId,
    context.localRevision
  ]);
}

export function commentAdditionalData(
  envelopeVersion: number,
  context?: CommentEncryptionContext
): Uint8Array<ArrayBuffer> {
  if (envelopeVersion === LEGACY_CONTENT_ENVELOPE_VERSION) {
    return encodeUtf8(
      `cipherspace.comment|${LEGACY_CONTENT_ENVELOPE_VERSION}|${NOTE_ENCRYPTION_ALGORITHM}|${WORKSPACE_KEY_VERSION}`
    );
  }
  if (envelopeVersion !== NOTE_ENVELOPE_VERSION) {
    throw new CipherSpaceCryptoError("invalid_payload", "Unsupported comment envelope version.");
  }
  assertCommentContext(context);
  return encodeCanonicalFields([
    "cipherspace.comment",
    NOTE_ENVELOPE_VERSION,
    NOTE_ENCRYPTION_ALGORITHM,
    WORKSPACE_KEY_VERSION,
    context.workspaceId,
    context.noteId,
    context.commentId,
    context.authorId,
    context.parentCommentId
  ]);
}
