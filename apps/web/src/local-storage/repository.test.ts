import { generateWorkspaceKey } from "@cipherspace/crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CipherSpaceLocalDatabase } from "./database";
import {
  decryptLocalNotePayload,
  encryptLocalNotePayload
} from "./notePayloadCrypto";
import {
  LegacyPlaintextMigrationError,
  LocalNotesRepository
} from "./repository";
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
    const durableStorageDump = JSON.stringify({
      conflicts: await database.conflicts.toArray(),
      notes: await database.notes.toArray(),
      pendingChanges: await database.pending_changes.toArray(),
      versions: await database.note_versions.toArray(),
      workspaceKeys: await database.workspace_keys.toArray()
    });
    expect(durableStorageDump).not.toContain(payload.title);
    expect(durableStorageDump).not.toContain(payload.body);
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

  it("detects legacy plaintext records in notes, pending changes, and conflicts", async () => {
    const notePayload = { body: "legacy note body", title: "Legacy note" };
    const note = await repository.createNote(workspaceId, notePayload, encrypted());
    const pending = (await repository.listPendingChanges(workspaceId))[0]!;
    await database.notes.update(note.key, { local_note_payload: notePayload });
    await database.pending_changes.update(pending.id, { local_note_payload: notePayload });

    const conflictPayload = { body: "legacy conflict body", title: "Legacy conflict" };
    const conflict = await createEditConflict(conflictPayload);
    await database.conflicts.update(conflict.key, {
      local_note_payload: conflictPayload,
      resolved_note_payload: { body: "legacy resolution", title: "Resolved conflict" }
    });

    database.close();
    database = new CipherSpaceLocalDatabase(databaseName);
    repository = new LocalNotesRepository(database, userId);

    await expect(repository.inspectLegacyPlaintextWorkspace(workspaceId)).resolves.toEqual({
      conflicts: 1,
      notes: 1,
      pendingChanges: 1,
      totalRecords: 3
    });
  });

  it("migrates both legacy conflict snapshots and verifies their plaintext fields are cleared", async () => {
    const localPayload = { body: "legacy local conflict", title: "Local conflict" };
    const resolvedPayload = { body: "legacy resolved conflict", title: "Resolution" };
    const conflict = await createEditConflict(localPayload);
    await database.conflicts.update(conflict.key, {
      local_encrypted_payload: null,
      local_note_payload: localPayload,
      resolved_encrypted_payload: null,
      resolved_note_payload: resolvedPayload
    });
    const key = await generateWorkspaceKey();

    await expect(repository.migratePlaintextWorkspace(workspaceId, key)).resolves.toBe(1);

    const stored = await database.conflicts.get(conflict.key);
    expect(stored?.local_note_payload).toBeNull();
    expect(stored?.resolved_note_payload).toBeNull();
    await expect(
      decryptLocalNotePayload(stored!.local_encrypted_payload!, key)
    ).resolves.toEqual(localPayload);
    await expect(
      decryptLocalNotePayload(stored!.resolved_encrypted_payload!, key)
    ).resolves.toEqual(resolvedPayload);
    expect(JSON.stringify(stored)).not.toContain("legacy local conflict");
    expect(JSON.stringify(stored)).not.toContain("legacy resolved conflict");
  });

  it("keeps every legacy record untouched when any migration plan is invalid", async () => {
    const validPayload = { body: "must remain until retry", title: "Valid legacy note" };
    const validNote = await repository.createNote(workspaceId, validPayload, encrypted());
    const invalidNote = await repository.createNote(
      workspaceId,
      { body: "invalid record", title: "Invalid legacy note" },
      encrypted()
    );
    await database.notes.update(validNote.key, {
      local_encrypted_payload: null,
      local_note_payload: validPayload
    });
    await database.notes.update(invalidNote.key, {
      local_encrypted_payload: null,
      local_note_payload: "unsupported legacy value" as unknown as LocalNotePayload
    });
    const key = await generateWorkspaceKey();

    await expect(repository.migratePlaintextWorkspace(workspaceId, key)).rejects.toBeInstanceOf(
      LegacyPlaintextMigrationError
    );

    await expect(database.notes.get(validNote.key)).resolves.toMatchObject({
      local_encrypted_payload: null,
      local_note_payload: validPayload
    });
    await expect(database.notes.get(invalidNote.key)).resolves.toMatchObject({
      local_encrypted_payload: null,
      local_note_payload: "unsupported legacy value"
    });
    await expect(repository.inspectLegacyPlaintextWorkspace(workspaceId)).resolves.toMatchObject({
      notes: 2,
      totalRecords: 2
    });
  });

  it("does not clear plaintext when an existing envelope cannot be verified", async () => {
    const payload = { body: "preserve this legacy value", title: "Legacy note" };
    const note = await repository.createNote(workspaceId, payload, encrypted());
    const encryptionKey = await generateWorkspaceKey();
    const unlockKey = await generateWorkspaceKey();
    const undecryptableEnvelope = await encryptLocalNotePayload(payload, encryptionKey);
    await database.notes.update(note.key, {
      local_encrypted_payload: undecryptableEnvelope,
      local_note_payload: payload
    });

    await expect(repository.migratePlaintextWorkspace(workspaceId, unlockKey)).rejects.toThrow(
      "cannot be verified"
    );
    await expect(database.notes.get(note.key)).resolves.toMatchObject({
      local_encrypted_payload: undecryptableEnvelope,
      local_note_payload: payload
    });
  });

  it("explicitly deletes all active local records for notes affected by legacy plaintext", async () => {
    const payload = { body: "delete only after confirmation", title: "Legacy local note" };
    const note = await repository.createNote(workspaceId, payload, encrypted());
    const pending = (await repository.listPendingChanges(workspaceId))[0]!;
    await database.notes.update(note.key, { local_note_payload: payload });
    await database.pending_changes.update(pending.id, { local_note_payload: payload });

    await expect(repository.deleteLegacyPlaintextWorkspace(workspaceId)).resolves.toBe(1);

    await expect(database.notes.get(note.key)).resolves.toBeUndefined();
    await expect(database.pending_changes.get(pending.id)).resolves.toBeUndefined();
    await expect(repository.inspectLegacyPlaintextWorkspace(workspaceId)).resolves.toMatchObject({
      totalRecords: 0
    });
  });

  it("does not retain pending or conflict plaintext during normal encrypted use", async () => {
    const marker = { body: "normal plaintext marker", title: "Normal encrypted conflict" };
    const conflict = await createEditConflict(marker);
    const pending = await database.pending_changes.get(conflict.pending_change_id);
    const storedConflict = await database.conflicts.get(conflict.key);

    expect(pending?.local_note_payload).toBeNull();
    expect(storedConflict?.local_note_payload).toBeNull();
    expect(storedConflict?.resolved_note_payload).toBeNull();
    expect(JSON.stringify([pending, storedConflict])).not.toContain(marker.body);
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
