import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CipherSpaceLocalDatabase } from "./database";
import { LocalNotesRepository } from "./repository";

const userId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";

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
      local_note_payload: { body: "three", title: "Renamed" },
      local_revision: 3,
      status: "pending"
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
});
