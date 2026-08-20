import { generateWorkspaceKey } from "@cipherspace/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EncryptedNote,
  EncryptedNoteDetail,
  NoteVersion,
  SyncPullResponse,
  SyncPushChange,
  SyncPushResponse
} from "../api/types";
import { CipherSpaceLocalDatabase } from "../local-storage/database";
import { LocalNotesRepository } from "../local-storage/repository";
import { NoteSyncEngine, type SyncTransport } from "./engine";

const ids = {
  client: "20000000-0000-4000-8000-000000000001",
  note: "30000000-0000-4000-8000-000000000001",
  operation: "40000000-0000-4000-8000-000000000001",
  operation2: "40000000-0000-4000-8000-000000000002",
  remoteUser: "00000000-0000-4000-8000-000000000002",
  user: "00000000-0000-4000-8000-000000000001",
  version1: "50000000-0000-4000-8000-000000000001",
  version2: "50000000-0000-4000-8000-000000000002",
  workspace: "10000000-0000-4000-8000-000000000001"
};

function version(id: string, versionNumber: number, parentVersionId: string | null): NoteVersion {
  return {
    clientVersion: String(versionNumber),
    contentNonce: btoa(String.fromCharCode(...new Array(12).fill(versionNumber))),
    createdAt: `2026-08-20T10:0${versionNumber}:00.000Z`,
    createdBy: versionNumber === 1 ? ids.user : ids.remoteUser,
    encryptedContent: btoa(`encrypted-${versionNumber}-with-tag`),
    encryptionMetadata: {
      algorithm: "AES-GCM",
      envelopeVersion: 1,
      keyId: "workspace-key-v1"
    },
    id,
    noteId: ids.note,
    parentVersionId,
    versionNumber
  };
}

function note(latestVersionId: string, updatedAt = "2026-08-20T10:01:00.000Z"): EncryptedNote {
  return {
    createdAt: "2026-08-20T10:00:00.000Z",
    createdBy: ids.user,
    deletedAt: null,
    encryptedTitle: null,
    encryptedTitleNonce: null,
    id: ids.note,
    latestVersionId,
    updatedAt,
    workspaceId: ids.workspace
  };
}

function detail(versionId = ids.version1): EncryptedNoteDetail {
  return {
    latestVersion: version(versionId, 1, null),
    note: note(versionId)
  };
}

describe("NoteSyncEngine", () => {
  let database: CipherSpaceLocalDatabase;
  let databaseName: string;
  let repository: LocalNotesRepository;
  let nextId: number;

  beforeEach(() => {
    databaseName = `cipherspace-sync-test-${crypto.randomUUID()}`;
    database = new CipherSpaceLocalDatabase(databaseName);
    nextId = 0;
    repository = new LocalNotesRepository(database, ids.user, {
      createClientId: () => ids.client,
      createId: () => {
        const values = [ids.note, ids.operation, ids.operation2];
        return values[nextId++] ?? crypto.randomUUID();
      },
      now: () => "2026-08-20T12:00:00.000Z"
    });
  });

  afterEach(async () => {
    await database.delete();
  });

  it("encrypts and pushes a pending change, marks it synced, and persists the pull cursor", async () => {
    await repository.createNote(ids.workspace, {
      body: "plaintext body must not cross the transport boundary",
      title: "Local draft"
    });
    let pushedChanges: SyncPushChange[] = [];
    const transport: SyncTransport = {
      pull: vi.fn(async (): Promise<SyncPullResponse> => ({
        changes: [],
        hasMore: false,
        nextCursor: "cursor-after-create",
        workspaceId: ids.workspace
      })),
      push: vi.fn(async (_workspaceId, _clientId, changes): Promise<SyncPushResponse> => {
        pushedChanges = changes;
        return {
          results: [
            {
              note: note(ids.version1),
              operationId: ids.operation,
              status: "accepted",
              version: version(ids.version1, 1, null)
            }
          ],
          workspaceId: ids.workspace
        };
      })
    };
    const workspaceKey = await generateWorkspaceKey();
    const engine = new NoteSyncEngine(repository, transport, {
      getWorkspaceKey: async () => workspaceKey
    });

    await expect(engine.syncWorkspace(ids.workspace)).resolves.toEqual({
      conflicts: 0,
      pulled: 0,
      pushed: 1
    });
    expect(pushedChanges).toHaveLength(1);
    expect(pushedChanges[0]?.encryptedPayload).not.toBeNull();
    expect(JSON.stringify(pushedChanges)).not.toContain("plaintext body");
    await expect(repository.listPendingChanges(ids.workspace)).resolves.toEqual([]);
    await expect(database.pending_changes.get(ids.operation)).resolves.toMatchObject({
      attempt_count: 1,
      status: "synced"
    });
    await expect(repository.getSyncMetadata(ids.workspace)).resolves.toMatchObject({
      client_id: ids.client,
      last_pull_cursor: "cursor-after-create"
    });

    database.close();
    database = new CipherSpaceLocalDatabase(databaseName);
    repository = new LocalNotesRepository(database, ids.user);
    await expect(repository.getSyncMetadata(ids.workspace)).resolves.toMatchObject({
      last_pull_cursor: "cursor-after-create"
    });
  });

  it("stores a conflict with local, remote, and base snapshots without overwriting the draft", async () => {
    await repository.cacheServerNoteDetail(detail());
    await repository.editNote(ids.note, {
      body: "my unsynced edit",
      title: "My local title"
    });
    const remoteVersion = version(ids.version2, 2, ids.version1);
    const remoteNote = note(ids.version2, "2026-08-20T10:02:00.000Z");
    const transport: SyncTransport = {
      pull: vi.fn(async (): Promise<SyncPullResponse> => ({
        changes: [
          {
            changeId: "60000000-0000-4000-8000-000000000001",
            note: remoteNote,
            operationType: "upsert_note_version",
            version: remoteVersion
          }
        ],
        hasMore: false,
        nextCursor: "cursor-after-conflict",
        workspaceId: ids.workspace
      })),
      push: vi.fn(async (_workspaceId, _clientId, changes): Promise<SyncPushResponse> => ({
        results: [
          {
            note: remoteNote,
            operationId: changes[0]!.operationId,
            remoteVersion,
            status: "conflict"
          }
        ],
        workspaceId: ids.workspace
      }))
    };
    const engine = new NoteSyncEngine(repository, transport, {
      getWorkspaceKey: generateWorkspaceKey
    });

    await expect(engine.syncWorkspace(ids.workspace)).resolves.toMatchObject({ conflicts: 1 });
    await expect(repository.getNote(ids.note)).resolves.toMatchObject({
      base_version_id: ids.version1,
      local_note_payload: { body: "my unsynced edit", title: "My local title" }
    });
    const conflicts = await repository.listConflicts(ids.workspace);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      base_version: { id: ids.version1 },
      base_version_id: ids.version1,
      local_note_payload: { body: "my unsynced edit", title: "My local title" },
      remote_version: { id: ids.version2 },
      status: "unresolved"
    });
    await expect(repository.getSyncMetadata(ids.workspace)).resolves.toMatchObject({
      last_pull_cursor: "cursor-after-conflict"
    });
  });

  it("pushes dependent create and update operations in order with the accepted base", async () => {
    const localNote = await repository.createNote(ids.workspace, {
      body: "first",
      title: "Offline note"
    });
    await repository.editNote(localNote.id, { body: "second", title: "Offline note" });
    const observed: SyncPushChange[] = [];
    const transport: SyncTransport = {
      pull: vi.fn(async (): Promise<SyncPullResponse> => ({
        changes: [],
        hasMore: false,
        nextCursor: "cursor-after-dependent-operations",
        workspaceId: ids.workspace
      })),
      push: vi.fn(async (_workspaceId, _clientId, changes): Promise<SyncPushResponse> => {
        const change = changes[0]!;
        observed.push(change);
        const isCreate = change.operationType === "create_note";
        const acceptedVersion = isCreate
          ? version(ids.version1, 1, null)
          : version(ids.version2, 2, ids.version1);
        return {
          results: [
            {
              note: note(acceptedVersion.id, acceptedVersion.createdAt),
              operationId: change.operationId,
              status: "accepted",
              version: acceptedVersion
            }
          ],
          workspaceId: ids.workspace
        };
      })
    };
    const engine = new NoteSyncEngine(repository, transport, {
      getWorkspaceKey: generateWorkspaceKey
    });

    await expect(engine.syncWorkspace(ids.workspace)).resolves.toMatchObject({ pushed: 2 });
    expect(observed.map((change) => [change.operationType, change.baseVersionId])).toEqual([
      ["create_note", null],
      ["update_note", ids.version1]
    ]);
    await expect(repository.getNote(ids.note)).resolves.toMatchObject({
      base_version_id: ids.version2,
      local_note_payload: { body: "second", title: "Offline note" }
    });
    await expect(repository.listPendingChanges(ids.workspace)).resolves.toEqual([]);
  });

  it("marks a failed attempt for retry without advancing the cursor", async () => {
    await repository.createNote(ids.workspace, { body: "offline", title: "Retry me" });
    const transport: SyncTransport = {
      pull: vi.fn(),
      push: vi.fn(async () => {
        throw new Error("network unavailable");
      })
    };
    const engine = new NoteSyncEngine(repository, transport, {
      getWorkspaceKey: generateWorkspaceKey
    });

    await expect(engine.syncWorkspace(ids.workspace)).rejects.toThrow("network unavailable");
    await expect(database.pending_changes.get(ids.operation)).resolves.toMatchObject({
      attempt_count: 1,
      last_error: "network unavailable",
      status: "failed"
    });
    await expect(repository.getSyncMetadata(ids.workspace)).resolves.toMatchObject({
      last_pull_cursor: null,
      last_sync_error: "network unavailable"
    });
  });
});
