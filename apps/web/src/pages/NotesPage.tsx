import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";

import { api } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import type { WorkspaceOutletContext } from "../layouts/WorkspaceLayout";
import { useLocalData, useLocalQuery } from "../local-storage/LocalDataContext";
import { queryKeys } from "../queryKeys";
import { formatDate, shortenOpaqueValue } from "../utils";

export function NotesPage() {
  const { workspace } = useOutletContext<WorkspaceOutletContext>();
  const canCreate = workspace.role !== "viewer";
  const localData = useLocalData();
  const navigate = useNavigate();
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const localNotesQuery = useLocalQuery(
    () => localData.listNotes(workspace.id),
    [localData, workspace.id]
  );
  const pendingChangesQuery = useLocalQuery(
    () => localData.listPendingChanges(workspace.id),
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
  const pendingByNote = new Map<string, number>();
  for (const change of pendingChangesQuery.data ?? []) {
    pendingByNote.set(change.note_id, (pendingByNote.get(change.note_id) ?? 0) + 1);
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setFormError(null);
    setIsCreating(true);
    try {
      const note = await localData.createNote(workspace.id, { body, title: trimmedTitle });
      navigate(`/workspaces/${workspace.id}/notes/${note.id}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save the local note.");
      setIsCreating(false);
    }
  };

  return (
    <div className="notes-layout">
      <section>
        <div className="section-heading section-heading--page">
          <div>
            <p className="eyebrow">Local-first notes</p>
            <h2>Notes</h2>
          </div>
          <div className="status-badges">
            {(pendingChangesQuery.data?.length ?? 0) > 0 ? (
              <span className="unsynced-badge">{pendingChangesQuery.data?.length} unsynced</span>
            ) : null}
            <span className="count-badge">{notes.length}</span>
          </div>
        </div>
        {serverNotesQuery.isError && notes.length > 0 ? (
          <div className="offline-callout" role="status">
            Offline cache in use. You can keep creating and editing notes; changes remain queued on
            this device.
          </div>
        ) : null}
        {localNotesQuery.isLoading ? <LoadingState label="Loading local notes…" /> : null}
        {localNotesQuery.error ? <ErrorState error={localNotesQuery.error} /> : null}
        {serverNotesQuery.isError && notes.length === 0 ? (
          <ErrorState error={serverNotesQuery.error} onRetry={() => void serverNotesQuery.refetch()} />
        ) : null}
        {!localNotesQuery.isLoading &&
        !serverNotesQuery.isLoading &&
        notes.length === 0 &&
        !serverNotesQuery.isError ? (
          <EmptyState
            description={canCreate ? "Create the first note. It will be stored locally before any future sync." : "No notes are cached for this workspace."}
            title="No notes yet"
          />
        ) : null}
        {notes.length ? (
          <div className="note-list">
            {notes.map((note, index) => {
              const titleLabel = note.local_note_payload?.title ??
                shortenOpaqueValue(note.encrypted_title, "Encrypted note");
              const pendingCount = pendingByNote.get(note.id) ?? 0;
              return (
                <Link key={note.id} to={note.id}>
                  <div className="note-index">{String(index + 1).padStart(2, "0")}</div>
                  <div>
                    <h3>{titleLabel}</h3>
                    <p>Updated {formatDate(note.updated_at)}</p>
                  </div>
                  {pendingCount > 0 ? (
                    <span className="unsynced-badge">Unsynced</span>
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
            <p className="eyebrow">Saved on this device</p>
            <h2>Create a local note</h2>
            <div className="info-callout">
              Saving creates a local note and queues a <code>create_note</code> change. Nothing is
              uploaded in this implementation step.
            </div>
            <form className="form-stack" onSubmit={(event) => void handleCreate(event)}>
              <label>
                Title
                <input
                  autoFocus
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Untitled note"
                  required
                  value={title}
                />
              </label>
              <label>
                Note body
                <textarea
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Write locally…"
                  rows={10}
                  value={body}
                />
              </label>
              {formError ? <div className="form-error" role="alert">{formError}</div> : null}
              <button className="button button--primary" disabled={isCreating || !title.trim()}>
                {isCreating ? "Saving locally…" : "Create local note"}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="eyebrow">Read-only access</p>
            <h2>Viewer role</h2>
            <p>You can read cached notes, but only owners and editors can create local changes.</p>
          </>
        )}
      </aside>
    </div>
  );
}
