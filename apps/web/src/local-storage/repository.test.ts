import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CipherSpaceLocalDatabase } from "./database";
import { LocalNotesRepository } from "./repository";
import type { LocalNotePayload } from "./types";

const userId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const remoteUserId = "00000000-0000-4000-8000-000000000003";
const noteId = "00000000-0000-4000-8000-000000000004";
const baseVersionId = "00000000-0000-4000-8000-000000000005";
const remoteVersionId = "00000000-0000-4000-8000-000000000006";

function serverVersion(id: string, versionNumber: number, parentVersionId: string | null) {
  return {
    clientVersion: String(versionNumber),
    contentNonce: "AAAAAAAAAAAAAAAA",
    createdAt: `2026-08-20T10:0${versionNumber}:00.000Z`,
    createdBy: versionNumber === 1 ? userId : remoteUserId,
    encryptedContent: "AAAAAAAAAAAAAAAAAAAAAA==",
    encryptionMetadata: {
      algorithm: "AES-GCM",
      envelopeVersion: 1,
      keyId: "workspace-key-v1"
    },
    id,
    noteId,
    parentVersionId,
    versionNumber
  };
}

function serverNote(latestVersionId: string) {
  return {
    createdAt: "2026-08-20T10:00:00.000Z",
    createdBy: userId,
    deletedAt: null,
    encryptedTitle: null,
    encryptedTitleNonce: null,
    id: noteId,
    latestVersionId,
    updatedAt: "2026-08-20T10:02:00.000Z",
    workspaceId
  };
}

function idSequence(): () => string {
  let next = 10;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
}

describe("LocalNotesRepository", () => {
  let database: CipherSpaceLocalDatabase;
  let databaseName: string;
  let repository: LocalNotesRepository;

  beforeEach(() => {
    databaseName = `cipherspace-test-${crypto.randomUUID()}`;
    database = new CipherSpaceLocalDatabase(databaseName);
    repository = new LocalNotesRepository(database, userId, {
      createId: idSequence(),
      now: () => "2026-08-20T10:00:00.000Z"
    });
  });

  afterEach(async () => {
    await database.delete();
  });

  async function createEditConflict(localPayload: LocalNotePayload) {
    await repository.cacheServerNoteDetail({
      latestVersion: serverVersion(baseVersionId, 1, null),
      note: serverNote(baseVersionId)
    });
    await repository.editNote(noteId, localPayload);
    const pending = (await repository.listPendingChanges(workspaceId))[0]!;
    const attempted = await repository.beginSyncAttempt([pending]);
    await repository.applyPushResults(workspaceId, attempted, [
      {
        note: serverNote(remoteVersionId),
        operationId: pending.id,
        remoteVersion: serverVersion(remoteVersionId, 2, baseVersionId),
        status: "conflict"
      }
    ]);
    return (await repository.listConflicts(workspaceId))[0]!;
  }

  it("creates a durable local note and a pending create operation atomically", async () => {
    const note = await repository.createNote(workspaceId, {
      body: "Stored before any network request.",
      title: "Offline draft"
    });

    await expect(repository.getNote(note.id)).resolves.toMatchObject({
      local_note_payload: {
        body: "Stored before any network request.",
        title: "Offline draft"
      },
      local_revision: 1,
      workspace_id: workspaceId
    });
    await expect(repository.listPendingChanges(workspaceId)).resolves.toEqual([
      expect.objectContaining({
        base_version_id: null,
        encrypted_payload: null,
        local_note_payload: {
          body: "Stored before any network request.",
          title: "Offline draft"
        },
        local_revision: 1,
        note_id: note.id,
        operation_type: "create_note",
        status: "pending"
      })
    ]);
    await expect(database.local_sync_metadata.count()).resolves.toBe(1);
  });

  it("updates the local note and coalesces repeated edits into one update operation", async () => {
    const note = await repository.createNote(workspaceId, { body: "one", title: "Draft" });

    await repository.editNote(note.id, { body: "two", title: "Draft" });
    await repository.editNote(note.id, { body: "three", title: "Renamed" });

    await expect(repository.getNote(note.id)).resolves.toMatchObject({
      local_note_payload: { body: "three", title: "Renamed" },
      local_revision: 3
    });
    const changes = await repository.listPendingChanges(workspaceId);
    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.operation_type)).toEqual([
      "create_note",
      "update_note"
    ]);
    expect(changes[1]).toMatchObject({
      encrypted_payload: null,
      local_note_payload: { body: "three", title: "Renamed" },
      local_revision: 3,
      status: "pending"
    });
  });

  it("discards prepared ciphertext when a pending edit changes again", async () => {
    const note = await repository.createNote(workspaceId, { body: "one", title: "Draft" });
    await repository.editNote(note.id, { body: "two", title: "Draft" });
    const update = (await repository.listPendingChanges(workspaceId))[1]!;
    await repository.storeEncryptedPayload(update.id, update.local_revision, {
      algorithm: "AES-GCM",
      ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
      envelopeVersion: 1,
      keyVersion: 1,
      nonce: "AAAAAAAAAAAAAAAA"
    });

    await repository.editNote(note.id, { body: "newest", title: "Draft" });

    await expect(database.pending_changes.get(update.id)).resolves.toMatchObject({
      encrypted_payload: null,
      local_note_payload: { body: "newest", title: "Draft" },
      local_revision: 3
    });
  });

  it("retains notes and pending changes when the database is reopened", async () => {
    const note = await repository.createNote(workspaceId, {
      body: "Survives reload",
      title: "Persistent"
    });
    database.close();

    database = new CipherSpaceLocalDatabase(databaseName);
    repository = new LocalNotesRepository(database, userId);

    await expect(repository.getNote(note.id)).resolves.toMatchObject({
      local_note_payload: { body: "Survives reload", title: "Persistent" }
    });
    await expect(repository.countPendingChanges(workspaceId)).resolves.toBe(1);
  });

  it("soft-deletes a note and records a pending delete operation", async () => {
    const note = await repository.createNote(workspaceId, { body: "Remove me", title: "Draft" });

    const deleted = await repository.deleteNote(note.id);

    expect(deleted.deleted_at).toBe("2026-08-20T10:00:00.000Z");
    await expect(repository.listNotes(workspaceId)).resolves.toEqual([]);
    await expect(repository.getNote(note.id)).resolves.toMatchObject({
      deleted_at: "2026-08-20T10:00:00.000Z",
      local_revision: 2
    });
    const changes = await repository.listPendingChanges(workspaceId);
    expect(changes.map((change) => change.operation_type)).toEqual([
      "create_note",
      "delete_note"
    ]);
    expect(changes[1]).toMatchObject({
      local_note_payload: null,
      local_revision: 2,
      status: "pending"
    });
  });

  it("rejects an invalid local payload before writing a note or queue record", async () => {
    await expect(repository.createNote(workspaceId, { body: "content", title: "   " })).rejects.toThrow(
      "Local note titles"
    );

    await expect(repository.listNotes(workspaceId)).resolves.toEqual([]);
    await expect(repository.listPendingChanges(workspaceId)).resolves.toEqual([]);
  });

  it.each([
    {
      expected: { body: "local body", title: "Local title" },
      input: { action: "keep_local" } as const,
      label: "keep-local"
    },
    {
      expected: { body: "remote body", title: "Remote title" },
      input: {
        action: "accept_remote",
        remote_payload: { body: "remote body", title: "Remote title" }
      } as const,
      label: "accept-remote"
    },
    {
      expected: { body: "merged body", title: "Merged title" },
      input: {
        action: "manual_merge",
        merged_payload: { body: "merged body", title: "Merged title" }
      } as const,
      label: "manual-merge"
    }
  ])("creates one rebased pending version for $label resolution", async ({ expected, input }) => {
    const conflict = await createEditConflict({ body: "local body", title: "Local title" });

    const resolvedChange = await repository.resolveConflict(conflict.id, input);

    await expect(repository.getNote(noteId)).resolves.toMatchObject({
      base_version_id: remoteVersionId,
      local_note_payload: expected,
      local_revision: 2
    });
    await expect(repository.countConflicts(workspaceId)).resolves.toBe(0);
    await expect(repository.listPendingChanges(workspaceId)).resolves.toEqual([
      expect.objectContaining({
        base_version_id: remoteVersionId,
        id: resolvedChange.id,
        local_note_payload: expected,
        operation_type: "update_note",
        status: "pending"
      })
    ]);
    const storedConflict = await database.conflicts.get(conflict.key);
    expect(storedConflict).toMatchObject({
      resolution: input.action,
      resolution_pending_change_id: resolvedChange.id,
      resolved_at: "2026-08-20T10:00:00.000Z",
      resolved_note_payload: expected,
      status: "resolved"
    });
    await expect(database.pending_changes.get(conflict.pending_change_id)).resolves.toMatchObject({
      status: "resolved"
    });
  });
});
