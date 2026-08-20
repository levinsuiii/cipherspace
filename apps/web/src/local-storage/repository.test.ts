import { generateWorkspaceKey } from "@cipherspace/crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CipherSpaceLocalDatabase } from "./database";
import { decryptLocalNotePayload } from "./notePayloadCrypto";
import { LocalNotesRepository } from "./repository";
import type { LocalNotePayload } from "./types";

const userId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const remoteUserId = "00000000-0000-4000-8000-000000000003";
const noteId = "00000000-0000-4000-8000-000000000004";
const baseVersionId = "00000000-0000-4000-8000-000000000005";
const remoteVersionId = "00000000-0000-4000-8000-000000000006";

function encrypted(ciphertext = "AAAAAAAAAAAAAAAAAAAAAA==") {
  return {
    algorithm: "AES-GCM" as const,
    ciphertext,
    envelopeVersion: 1 as const,
    keyVersion: 1 as const,
    nonce: "AAAAAAAAAAAAAAAA"
  };
}

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
    await repository.editNote(noteId, localPayload, encrypted());
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
    const payload = {
      body: "Stored before any network request.",
      title: "Offline draft"
    };
    const envelope = encrypted();
    const note = await repository.createNote(workspaceId, payload, envelope);

    await expect(repository.getNote(note.id)).resolves.toMatchObject({
      local_encrypted_payload: envelope,
      local_note_payload: null,
      local_revision: 1,
      workspace_id: workspaceId
    });
    await expect(repository.listPendingChanges(workspaceId)).resolves.toEqual([
      expect.objectContaining({
        base_version_id: null,
        encrypted_payload: envelope,
        local_note_payload: null,
        local_revision: 1,
        note_id: note.id,
        operation_type: "create_note",
        status: "pending"
      })
    ]);
    await expect(database.local_sync_metadata.count()).resolves.toBe(1);
  });

  it("updates the local note and coalesces repeated edits into one update operation", async () => {
    const note = await repository.createNote(
      workspaceId, { body: "one", title: "Draft" }, encrypted("create")
    );

    await repository.editNote(note.id, { body: "two", title: "Draft" }, encrypted("edit-1"));
    await repository.editNote(note.id, { body: "three", title: "Renamed" }, encrypted("edit-2"));

    await expect(repository.getNote(note.id)).resolves.toMatchObject({
      local_encrypted_payload: encrypted("edit-2"),
      local_note_payload: null,
      local_revision: 3
    });
    const changes = await repository.listPendingChanges(workspaceId);
    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.operation_type)).toEqual([
      "create_note",
      "update_note"
    ]);
    expect(changes[1]).toMatchObject({
      encrypted_payload: encrypted("edit-2"),
      local_note_payload: null,
      local_revision: 3,
      status: "pending"
    });
  });

  it("replaces pending ciphertext when a local edit changes again", async () => {
    const note = await repository.createNote(
      workspaceId, { body: "one", title: "Draft" }, encrypted("create")
    );
    await repository.editNote(note.id, { body: "two", title: "Draft" }, encrypted("edit-1"));
    const update = (await repository.listPendingChanges(workspaceId))[1]!;
    await repository.storeEncryptedPayload(update.id, update.local_revision, {
      algorithm: "AES-GCM",
      ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
      envelopeVersion: 1,
      keyVersion: 1,
      nonce: "AAAAAAAAAAAAAAAA"
    });

    await repository.editNote(note.id, { body: "newest", title: "Draft" }, encrypted("newest"));

    await expect(database.pending_changes.get(update.id)).resolves.toMatchObject({
      encrypted_payload: encrypted("newest"),
      local_note_payload: null,
      local_revision: 3
    });
  });

  it("retains notes and pending changes when the database is reopened", async () => {
    const envelope = encrypted("persistent");
    const note = await repository.createNote(
      workspaceId, { body: "Survives reload", title: "Persistent" }, envelope
    );
    database.close();

    database = new CipherSpaceLocalDatabase(databaseName);
    repository = new LocalNotesRepository(database, userId);

    await expect(repository.getNote(note.id)).resolves.toMatchObject({
      local_encrypted_payload: envelope,
      local_note_payload: null
    });
    await expect(repository.countPendingChanges(workspaceId)).resolves.toBe(1);
  });

  it("migrates legacy note and queue plaintext after unlock and removes readable storage", async () => {
    const legacyPayload = { body: "legacy secret body", title: "Legacy secret title" };
    const note = await repository.createNote(workspaceId, legacyPayload, encrypted());
    const pending = (await repository.listPendingChanges(workspaceId))[0]!;
    await database.notes.update(note.key, {
      local_encrypted_payload: null,
      local_note_payload: legacyPayload
    });
    await database.pending_changes.update(pending.id, {
      encrypted_payload: null,
      local_note_payload: legacyPayload
    });

    const key = await generateWorkspaceKey();
    await expect(repository.migratePlaintextWorkspace(workspaceId, key)).resolves.toBe(2);

    const storedNote = await repository.getNote(note.id);
    const storedChange = await database.pending_changes.get(pending.id);
    expect(storedNote?.local_note_payload).toBeNull();
    expect(storedChange?.local_note_payload).toBeNull();
    expect(storedNote?.local_encrypted_payload).not.toBeNull();
    expect(storedChange?.encrypted_payload).not.toBeNull();
    await expect(
      decryptLocalNotePayload(storedNote!.local_encrypted_payload!, key)
    ).resolves.toEqual(legacyPayload);
    expect(JSON.stringify([storedNote, storedChange])).not.toContain("legacy secret");
  });

  it("soft-deletes a note and records a pending delete operation", async () => {
    const note = await repository.createNote(
      workspaceId, { body: "Remove me", title: "Draft" }, encrypted()
    );

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
    await expect(repository.createNote(
      workspaceId, { body: "content", title: "   " }, encrypted()
    )).rejects.toThrow(
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
  ])("creates one rebased pending version for $label resolution", async ({ input }) => {
    const conflict = await createEditConflict({ body: "local body", title: "Local title" });

    const resolvedEnvelope = encrypted(`resolved-${input.action}`);
    const resolvedChange = await repository.resolveConflict(conflict.id, input, resolvedEnvelope);

    await expect(repository.getNote(noteId)).resolves.toMatchObject({
      base_version_id: remoteVersionId,
      local_encrypted_payload: expect.any(Object),
      local_note_payload: null,
      local_revision: 2
    });
    await expect(repository.countConflicts(workspaceId)).resolves.toBe(0);
    await expect(repository.listPendingChanges(workspaceId)).resolves.toEqual([
      expect.objectContaining({
        base_version_id: remoteVersionId,
        id: resolvedChange.id,
        encrypted_payload: expect.any(Object),
        local_note_payload: null,
        operation_type: "update_note",
        status: "pending"
      })
    ]);
    const storedConflict = await database.conflicts.get(conflict.key);
    expect(storedConflict).toMatchObject({
      resolution: input.action,
      resolution_pending_change_id: resolvedChange.id,
      resolved_at: "2026-08-20T10:00:00.000Z",
      resolved_encrypted_payload: expect.any(Object),
      resolved_note_payload: null,
      status: "resolved"
    });
    await expect(database.pending_changes.get(conflict.pending_change_id)).resolves.toMatchObject({
      status: "resolved"
    });
  });
});
