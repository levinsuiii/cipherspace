import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";

import { api } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { useWorkspaceKey } from "../key-management/WorkspaceKeyContext";
import type { WorkspaceOutletContext } from "../layouts/WorkspaceLayout";
import { useLocalData, useLocalQuery } from "../local-storage/LocalDataContext";
import { decryptLocalNotePayload } from "../local-storage/notePayloadCrypto";
import { queryKeys } from "../queryKeys";
import { formatDate } from "../utils";

export function NotesPage() {
  const { workspace } = useOutletContext<WorkspaceOutletContext>();
  const canCreate = workspace.role !== "viewer";
  const localData = useLocalData();
  const workspaceKey = useWorkspaceKey(workspace.id);
  const navigate = useNavigate();
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [decryptedTitles, setDecryptedTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const localNotesQuery = useLocalQuery(
    () => localData.listNotes(workspace.id),
    [localData, workspace.id]
  );
  const pendingChangesQuery = useLocalQuery(
    () => localData.listPendingChanges(workspace.id),
    [localData, workspace.id]
  );
  const conflictsQuery = useLocalQuery(
    () => localData.listConflicts(workspace.id),
    [localData, workspace.id]
  );
  const serverNotesQuery = useQuery({
    queryKey: queryKeys.notes(workspace.id),
    queryFn: async () => {
      const result = await api.notes.list(workspace.id);
      await localData.cacheServerNotes(workspace.id, result.notes);
      return result;
    },
    retry: false
  });

  const notes = localNotesQuery.data ?? [];

  useEffect(() => {
    if (workspaceKey.status === "unlocked") return;
    setBody("");
    setTitle("");
    setFormError(null);
  }, [workspaceKey.status]);

  useEffect(() => {
    let active = true;
    setDecryptedTitles(new Map());
    if (workspaceKey.status !== "unlocked" || notes.length === 0) {
      return () => { active = false; };
    }
    void workspaceKey.getKey()
      .then(async (key) => Promise.all(notes.map(async (note) => {
        if (note.local_encrypted_payload) {
          const payload = await decryptLocalNotePayload(note.local_encrypted_payload, key, {
            localRevision: note.local_revision,
            noteId: note.id,
            workspaceId: note.workspace_id
          });
          return [note.id, payload.title] as const;
        }
        if (note.local_note_payload) return [note.id, note.local_note_payload.title] as const;
        return [note.id, "Verschlüsselte Notiz"] as const;
      })))
      .then((entries) => {
        if (active) setDecryptedTitles(new Map(entries));
      })
      .catch(() => {
        if (active) setDecryptedTitles(new Map());
      });
    return () => { active = false; };
  }, [notes, workspaceKey.getKey, workspaceKey.status]);
  const pendingByNote = new Map<string, number>();
  const conflictsByNote = new Map<string, number>();
  for (const change of pendingChangesQuery.data ?? []) {
    pendingByNote.set(change.note_id, (pendingByNote.get(change.note_id) ?? 0) + 1);
  }
  for (const conflict of conflictsQuery.data ?? []) {
    conflictsByNote.set(conflict.note_id, (conflictsByNote.get(conflict.note_id) ?? 0) + 1);
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setFormError(null);
    setIsCreating(true);
    try {
      const payload = { body, title: trimmedTitle };
      const key = await workspaceKey.getKey();
      const note = await localData.createEncryptedNote(workspace.id, payload, key);
      navigate(`/workspaces/${workspace.id}/notes/${note.id}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Die Notiz konnte nicht lokal gespeichert werden.");
      setIsCreating(false);
    }
  };

  return (
    <div className="notes-layout">
      <section>
        <div className="section-heading section-heading--page">
          <div>
            <p className="eyebrow">Lokal gespeicherte Inhalte</p>
            <h2>Notizen</h2>
          </div>
          <div className="status-badges">
            {(conflictsQuery.data?.length ?? 0) > 0 ? (
              <span className="conflict-badge">{conflictsQuery.data?.length} Konflikte</span>
            ) : null}
            {(pendingChangesQuery.data?.length ?? 0) > 0 ? (
              <span className="unsynced-badge">{pendingChangesQuery.data?.length} ausstehend</span>
            ) : null}
            <span className="count-badge">{notes.length}</span>
          </div>
        </div>
        {serverNotesQuery.isError && notes.length > 0 ? (
          <div className="offline-callout" role="status">
            Der lokale Speicher wird verwendet. Du kannst weiterarbeiten; Änderungen bleiben auf
            diesem Gerät vorgemerkt.
          </div>
        ) : null}
        {localNotesQuery.isLoading ? <LoadingState label="Lokale Notizen werden geladen…" /> : null}
        {localNotesQuery.error ? <ErrorState error={localNotesQuery.error} /> : null}
        {serverNotesQuery.isError && notes.length === 0 ? (
          <ErrorState error={serverNotesQuery.error} onRetry={() => void serverNotesQuery.refetch()} />
        ) : null}
        {!localNotesQuery.isLoading &&
        !serverNotesQuery.isLoading &&
        notes.length === 0 &&
        !serverNotesQuery.isError ? (
          <EmptyState
            description={canCreate ? "Erstelle die erste Notiz. Sie wird vor jeder Synchronisation lokal gespeichert." : "Für diesen Workspace sind keine Notizen gespeichert."}
            title="Noch keine Notiz vorhanden"
          />
        ) : null}
        {notes.length ? (
          <div className="note-list">
            {notes.map((note, index) => {
              const titleLabel = workspaceKey.status === "unlocked"
                ? decryptedTitles.get(note.id) ?? "Verschlüsselte Notiz"
                : "Verschlüsselte Notiz";
              const pendingCount = pendingByNote.get(note.id) ?? 0;
              const conflictCount = conflictsByNote.get(note.id) ?? 0;
              return (
                <Link
                  key={note.id}
                  to={conflictCount > 0 ? `${note.id}/conflict` : note.id}
                >
                  <div className="note-index">{String(index + 1).padStart(2, "0")}</div>
                  <div>
                    <h3>{titleLabel}</h3>
                    <p>Aktualisiert am {formatDate(note.updated_at)}</p>
                  </div>
                  {conflictCount > 0 ? (
                    <span className="conflict-badge">Konflikt</span>
                  ) : pendingCount > 0 ? (
                    <span className="unsynced-badge">Ausstehend</span>
                  ) : (
                    <span className="mono note-id">{note.id.slice(0, 8)}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ) : null}
      </section>

      <aside className="panel panel--sticky">
        {canCreate ? (
          <>
            <p className="eyebrow">Auf diesem Gerät</p>
            <h2>Notiz erstellen</h2>
            <div className="info-callout">
              Notizen werden verschlüsselt gespeichert. Zum Schreiben und Lesen muss der
              Workspace-Schlüssel entsperrt sein.
            </div>
            {workspaceKey.status !== "unlocked" ? (
              <div className="warning-callout" role="status">
                Entsperre oder erstelle oben den Workspace-Schlüssel, bevor du schreibst.
              </div>
            ) : null}
            <form className="form-stack" onSubmit={(event) => void handleCreate(event)}>
              <label>
                Titel
                <input
                  autoFocus
                  disabled={workspaceKey.status !== "unlocked"}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Unbenannte Notiz"
                  required
                  value={title}
                />
              </label>
              <label>
                Inhalt
                <textarea
                  disabled={workspaceKey.status !== "unlocked"}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Lokal schreiben…"
                  rows={10}
                  value={body}
                />
              </label>
              {formError ? <div className="form-error" role="alert">{formError}</div> : null}
              <button className="button button--primary" disabled={
                isCreating || !title.trim() || workspaceKey.status !== "unlocked"
              }>
                {isCreating ? "Wird lokal gespeichert…" : "Notiz erstellen"}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="eyebrow">Nur lesen</p>
            <h2>Leser-Rolle</h2>
            <p>Du kannst gespeicherte Notizen lesen. Änderungen sind Besitzern und Editoren vorbehalten.</p>
          </>
        )}
      </aside>
    </div>
  );
}
