import { createHash, randomUUID } from "node:crypto";

import type { StoredEncryptedNote, StoredNoteVersion } from "../notes/repository.js";
import type { WorkspaceRepository } from "../workspaces/repository.js";
import type {
  ProcessSyncOperationResult,
  StoredSyncOutcome,
  SyncOperationType,
  SyncRepository
} from "./repository.js";

export interface SyncEncryptedPayload {
  algorithm: string;
  ciphertext: string;
  envelopeVersion: number;
  keyVersion: number;
  nonce: string;
}

export interface PushChangeInput {
  baseVersionId: string | null;
  clientRevision: number;
  createdAtClient: string;
  encryptedPayload: SyncEncryptedPayload | null;
  noteId: string;
  operationId: string;
  operationType: SyncOperationType;
}

export interface PushRequestInput {
  changes: PushChangeInput[];
  clientId: string;
}

export interface PublicSyncNote {
  createdAt: string;
  createdBy: string;
  deletedAt: string | null;
  encryptedTitle: string | null;
  encryptedTitleNonce: string | null;
  id: string;
  latestVersionId: string;
  updatedAt: string;
  workspaceId: string;
}

export interface PublicSyncVersion {
  clientVersion: string | null;
  contentNonce: string;
  createdAt: string;
  createdBy: string;
  encryptedContent: string;
  encryptionMetadata: {
    algorithm: string;
    envelopeVersion: number;
    keyId: string;
  };
  id: string;
  noteId: string;
  parentVersionId: string | null;
  versionNumber: number;
}

export type PushResult =
  | {
      note: PublicSyncNote;
      operationId: string;
      originalStatus?: "accepted";
      status: "accepted" | "duplicate";
      version: PublicSyncVersion;
    }
  | {
      note: PublicSyncNote;
      operationId: string;
      originalStatus?: "conflict";
      remoteVersion: PublicSyncVersion;
      status: "conflict" | "duplicate";
    }
  | {
      errorCode: "idempotency_key_reused" | "note_not_found" | "write_forbidden";
      operationId: string;
      status: "rejected";
    };

export interface PullChange {
  changeId: string;
  note: PublicSyncNote;
  operationType: "delete_note" | "upsert_note_version";
  version: PublicSyncVersion;
}

export class SyncWorkspaceNotFoundError extends Error {}
export class InvalidSyncCursorError extends Error {}

function publicNote(note: StoredEncryptedNote): PublicSyncNote {
  return {
    createdAt: note.createdAt.toISOString(),
    createdBy: note.creatorUserId,
    deletedAt: note.deletedAt?.toISOString() ?? null,
    encryptedTitle: note.encryptedTitle?.toString("base64") ?? null,
    encryptedTitleNonce: note.encryptedTitleNonce?.toString("base64") ?? null,
    id: note.id,
    latestVersionId: note.currentVersionId,
    updatedAt: note.updatedAt.toISOString(),
    workspaceId: note.workspaceId
  };
}

function publicVersion(version: StoredNoteVersion): PublicSyncVersion {
  return {
    clientVersion: version.clientVersion,
    contentNonce: version.payloadNonce.toString("base64"),
    createdAt: version.createdAt.toISOString(),
    createdBy: version.authorUserId,
    encryptedContent: version.encryptedPayload.toString("base64"),
    encryptionMetadata: {
      algorithm: version.encryptionAlgorithm,
      envelopeVersion: version.envelopeVersion,
      keyId: version.payloadKeyId
    },
    id: version.id,
    noteId: version.noteId,
    parentVersionId: version.parentVersionId,
    versionNumber: version.versionNumber
  };
}

function requestHash(change: PushChangeInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        baseVersionId: change.baseVersionId,
        clientRevision: change.clientRevision,
        createdAtClient: change.createdAtClient,
        encryptedPayload: change.encryptedPayload,
        noteId: change.noteId,
        operationId: change.operationId,
        operationType: change.operationType
      })
    )
    .digest("hex");
}

function cursorFor(workspaceId: string, sequence: bigint): string {
  return Buffer.from(JSON.stringify({ sequence: sequence.toString(), version: 1, workspaceId }))
    .toString("base64url");
}

function sequenceFromCursor(workspaceId: string, cursor: string | null): bigint {
  if (cursor === null) return 0n;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded) ||
      Object.keys(decoded).sort().join(",") !== "sequence,version,workspaceId"
    ) {
      throw new Error("invalid shape");
    }
    const value = decoded as { sequence?: unknown; version?: unknown; workspaceId?: unknown };
    if (
      value.version !== 1 ||
      value.workspaceId !== workspaceId ||
      typeof value.sequence !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(value.sequence)
    ) {
      throw new Error("invalid fields");
    }
    return BigInt(value.sequence);
  } catch (error) {
    throw new InvalidSyncCursorError("The sync cursor is invalid.", { cause: error });
  }
}

function pushResult(
  operationId: string,
  processed: Extract<ProcessSyncOperationResult, { outcome: StoredSyncOutcome }>
): PushResult {
  const { outcome, replayed } = processed;
  if (outcome.status === "accepted") {
    return {
      note: publicNote(outcome.note),
      operationId,
      ...(replayed ? { originalStatus: "accepted" as const } : {}),
      status: replayed ? "duplicate" : "accepted",
      version: publicVersion(outcome.version)
    };
  }
  return {
    note: publicNote(outcome.note),
    operationId,
    ...(replayed ? { originalStatus: "conflict" as const } : {}),
    remoteVersion: publicVersion(outcome.remoteVersion),
    status: replayed ? "duplicate" : "conflict"
  };
}

export class SyncService {
  public constructor(
    private readonly repository: SyncRepository,
    private readonly workspaceRepository: WorkspaceRepository
  ) {}

  public async push(
    workspaceId: string,
    userId: string,
    input: PushRequestInput
  ): Promise<{ results: PushResult[]; workspaceId: string }> {
    await this.requireMembership(workspaceId, userId);
    const results: PushResult[] = [];
    for (const change of input.changes) {
      const processed = await this.repository.processOperation({
        baseVersionId: change.baseVersionId,
        changeId: randomUUID(),
        clientId: input.clientId,
        clientRevision: change.clientRevision,
        createdAtClient: new Date(change.createdAtClient),
        noteId: change.noteId,
        operationId: change.operationId,
        operationType: change.operationType,
        payload: change.encryptedPayload
          ? {
              ciphertext: Buffer.from(change.encryptedPayload.ciphertext, "base64"),
              encryptionAlgorithm: change.encryptedPayload.algorithm,
              envelopeVersion: change.encryptedPayload.envelopeVersion,
              keyId: `workspace-key-v${change.encryptedPayload.keyVersion}`,
              nonce: Buffer.from(change.encryptedPayload.nonce, "base64")
            }
          : null,
        requestHash: requestHash(change),
        userId,
        versionId: randomUUID(),
        workspaceId
      });
      if (!("rejected" in processed)) {
        results.push(pushResult(change.operationId, processed));
        continue;
      }
      results.push({
        errorCode:
          processed.reason === "idempotency_mismatch"
            ? "idempotency_key_reused"
            : processed.reason === "note_not_found"
              ? "note_not_found"
              : "write_forbidden",
        operationId: change.operationId,
        status: "rejected"
      });
    }
    return { results, workspaceId };
  }

  public async pull(
    workspaceId: string,
    userId: string,
    cursor: string | null
  ): Promise<{
    changes: PullChange[];
    hasMore: boolean;
    nextCursor: string;
    workspaceId: string;
  }> {
    await this.requireMembership(workspaceId, userId);
    const afterSequence = sequenceFromCursor(workspaceId, cursor);
    const pageSize = 500;
    const storedChanges = await this.repository.pullChanges(workspaceId, afterSequence, pageSize + 1);
    const hasMore = storedChanges.length > pageSize;
    const page = storedChanges.slice(0, pageSize);
    const nextSequence = page.at(-1)?.sequenceNumber ?? afterSequence;
    return {
      changes: page.map((change) => ({
        changeId: change.changeId,
        note: publicNote(change.note),
        operationType:
          change.changeType === "note.deleted" ? "delete_note" : "upsert_note_version",
        version: publicVersion(change.version)
      })),
      hasMore,
      nextCursor: cursorFor(workspaceId, nextSequence),
      workspaceId
    };
  }

  private async requireMembership(workspaceId: string, userId: string): Promise<void> {
    if (!(await this.workspaceRepository.findMember(workspaceId, userId))) {
      throw new SyncWorkspaceNotFoundError();
    }
  }
}
