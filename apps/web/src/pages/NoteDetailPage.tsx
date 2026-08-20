import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";

import { api } from "../api/client";
import { ErrorState, LoadingState } from "../components/AsyncState";
import { CommentSection } from "../comments/CommentSection";
import { useWorkspaceKey } from "../key-management/WorkspaceKeyContext";
import type { WorkspaceOutletContext } from "../layouts/WorkspaceLayout";
import { useLocalData, useLocalQuery } from "../local-storage/LocalDataContext";
import {
  decryptLocalNotePayload,
  encryptLocalNotePayload
} from "../local-storage/notePayloadCrypto";
import type { LocalNotePayload } from "../local-storage/types";
import { queryKeys } from "../queryKeys";
import { decryptCachedNoteVersion } from "../sync/crypto";
import { formatDate, shortenOpaqueValue } from "../utils";

export function NoteDetailPage() {
  const { workspace } = useOutletContext<WorkspaceOutletContext>();
  const { noteId = "" } = useParams();
  const localData = useLocalData();
  const workspaceKey = useWorkspaceKey(workspace.id);
  const navigate = useNavigate();
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [decryptedPayload, setDecryptedPayload] =
    useState<LocalNotePayload | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const localNoteQuery = useLocalQuery(
    () => localData.getNote(noteId),
    [localData, noteId]
  );
  const versionQuery = useLocalQuery(
    () => localData.getLatestVersion(noteId),
    [localData, noteId]
  );
  const pendingCountQuery = useLocalQuery(
    () => localData.countPendingChangesForNote(noteId),
    [localData, noteId]
  );
  const conflictCountQuery = useLocalQuery(
    () => localData.countConflictsForNote(noteId),
    [localData, noteId]
  );
  const serverNoteQuery = useQuery({
    enabled: Boolean(noteId),
    queryKey: queryKeys.note(workspace.id, noteId),
    queryFn: async () => {
      const result = await api.notes.get(workspace.id, noteId);
      await localData.cacheServerNoteDetail(result);
      return result;
    },
    retry: false
  });
  const note = localNoteQuery.data;
  const latestVersion = versionQuery.data;
  const hasConflict = (conflictCountQuery.data ?? 0) > 0;
  const hasReadablePayload = Boolean(decryptedPayload);
  const canEdit = workspace.role !== "viewer" && !hasConflict && hasReadablePayload &&
    workspaceKey.status === "unlocked";
  const canDelete = workspace.role === "owner";

  useEffect(() => {
    let active = true;
    setTitle("");
    setBody("");
    setDecryptedPayload(null);
    setDecryptError(null);
    setIsDecrypting(false);
    if (!note || workspaceKey.status !== "unlocked") {
      return () => { active = false; };
    }

    setIsDecrypting(true);
    void workspaceKey.getKey()
      .then(async (key) => {
        if (note.local_encrypted_payload) {
          return decryptLocalNotePayload(note.local_encrypted_payload, key);
        }
        if (note.local_note_payload) return note.local_note_payload;
        if (latestVersion) return decryptCachedNoteVersion(latestVersion, key);
        throw new Error("This note has no encrypted content to decrypt.");
      })
      .then((payload) => {
        if (!active) return;
        setDecryptedPayload(payload);
        setTitle(payload.title);
        setBody(payload.body);
      })
      .catch(() => {
        if (active) {
          setDecryptError(
            "This note could not be decrypted. The workspace may be using a different key."
          );
        }
      })
      .finally(() => {
        if (active) setIsDecrypting(false);
      });

    return () => { active = false; };
  }, [
    latestVersion?.id,
    note?.id,
    note?.local_revision,
    note?.local_encrypted_payload,
    workspaceKey.getKey,
    workspaceKey.status
  ]);

  if (!note && (localNoteQuery.isLoading || serverNoteQuery.isLoading || serverNoteQuery.isSuccess)) {
    return <LoadingState label="Loading local note…" />;
  }
  if (!note && serverNoteQuery.isError) {
    return <ErrorState error={serverNoteQuery.error} onRetry={() => void serverNoteQuery.refetch()} />;
  }
  if (!note) return <ErrorState error={new Error("Note not found in the local cache.")} />;

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setSaveError(null);
    setSaveMessage(null);
    setIsSaving(true);
    try {
      const payload = { body, title: trimmedTitle };
      const key = await workspaceKey.getKey();
      const encryptedPayload = await encryptLocalNotePayload(payload, key);
      await localData.editNote(note.id, payload, encryptedPayload);
      setSaveMessage("Saved locally. This change is queued for sync.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the local note.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaveError(null);
    setIsDeleting(true);
    try {
      await localData.deleteNote(note.id);
      navigate(`/workspaces/${workspace.id}/notes`, { replace: true });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not delete the local note.");
      setIsDeleting(false);
    }
  };

  const displayTitle = workspaceKey.status === "unlocked"
    ? decryptedPayload?.title ?? shortenOpaqueValue(note.encrypted_title, "Encrypted note")
    : "Encrypted note";

  return (
    <section className="note-detail">
      <Link className="back-link" to={`/workspaces/${workspace.id}/notes`}>← Back to notes</Link>
      {serverNoteQuery.isError ? (
        <div className="offline-callout" role="status">
          The server is unavailable. Editing continues against the durable local copy.
        </div>
      ) : null}
      <header className="page-header page-header--compact">
        <div>
          <p className="eyebrow">Local note editor</p>
          <h2>{displayTitle}</h2>
          <p>Every save updates IndexedDB before a sync attempt can occur.</p>
        </div>
        {hasConflict ? (
          <Link
            className="conflict-badge"
            to={`/workspaces/${workspace.id}/notes/${note.id}/conflict`}
          >
            Resolve conflict
          </Link>
        ) : (pendingCountQuery.data ?? 0) > 0 ? (
          <span className="unsynced-badge">{pendingCountQuery.data} unsynced</span>
        ) : (
          <span className="version-badge">
            {latestVersion ? `Server version ${latestVersion.version_number}` : "Local only"}
          </span>
        )}
      </header>

      {hasConflict ? (
        <div className="warning-callout">
          Local editing is paused for this note so neither side is changed accidentally. Review
          the local and server versions, then choose a resolution.
          {" "}<Link to={`/workspaces/${workspace.id}/notes/${note.id}/conflict`}>Open conflict resolution</Link>
        </div>
      ) : null}

      {note.local_encrypted_payload || note.local_note_payload || latestVersion ? (
        workspaceKey.status !== "unlocked" ? (
          <div className="warning-callout" role="status">
            This note is encrypted on this device. Unlock the workspace key above to read it.
          </div>
        ) : isDecrypting ? (
          <div className="info-callout" role="status">Decrypting the note in memory…</div>
        ) : decryptError ? (
          <div className="form-error" role="alert">{decryptError}</div>
        ) : decryptedPayload ? (
          <div className="info-callout" role="status">
            Decrypted in memory. Lock the workspace to clear the readable editor state.
          </div>
        ) : null
      ) : null}

      <div className="detail-grid">
        <section className="panel">
          <form className="form-stack note-editor" onSubmit={(event) => void handleSave(event)}>
            <label>
              Title
              <input
                disabled={!canEdit}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={hasReadablePayload ? "Note title" : "Unlock to decrypt this note"}
                required
                value={workspaceKey.status === "unlocked" ? title : ""}
              />
            </label>
            <label>
              Note body
              <textarea
                disabled={!canEdit}
                onChange={(event) => setBody(event.target.value)}
                placeholder={hasReadablePayload ? "Write locally…" : "Unlock to decrypt this note."}
                rows={18}
                value={workspaceKey.status === "unlocked" ? body : ""}
              />
            </label>
            {saveError ? <div className="form-error" role="alert">{saveError}</div> : null}
            {saveMessage ? <div className="success-callout" role="status">{saveMessage}</div> : null}
            {canEdit ? (
              <div className="editor-actions">
                <button className="button button--primary" disabled={isSaving || !title.trim()}>
                  {isSaving ? "Saving locally…" : "Save local change"}
                </button>
                {canDelete ? (
                  <button
                    className="button button--danger"
                    disabled={isDeleting}
                    onClick={() => void handleDelete()}
                    type="button"
                  >
                    {isDeleting ? "Deleting locally…" : "Delete locally"}
                  </button>
                ) : null}
              </div>
            ) : hasConflict ? (
              <Link
                className="button button--primary"
                to={`/workspaces/${workspace.id}/notes/${note.id}/conflict`}
              >
                Resolve conflict
              </Link>
            ) : workspace.role === "viewer" ? (
              <p className="read-only-message">Viewer access is read-only.</p>
            ) : (
              <p className="read-only-message">Unlock and decrypt this note before editing it.</p>
            )}
          </form>
        </section>
        <aside className="panel workspace-summary">
          <h3>Local record</h3>
          <dl>
            <div><dt>Updated</dt><dd>{formatDate(note.updated_at)}</dd></div>
            <div><dt>Local revision</dt><dd>{note.local_revision}</dd></div>
            <div><dt>Base version ID</dt><dd className="mono">{note.base_version_id ?? "Local only"}</dd></div>
            <div><dt>Note ID</dt><dd className="mono">{note.id}</dd></div>
          </dl>
          {latestVersion ? (
            <details className="cached-envelope">
              <summary>Cached server envelope</summary>
              <dl>
                <div><dt>Version</dt><dd>{latestVersion.version_number}</dd></div>
                <div><dt>Algorithm</dt><dd>{latestVersion.encryption_algorithm}</dd></div>
                <div><dt>Key ID</dt><dd className="mono">{latestVersion.key_id}</dd></div>
              </dl>
            </details>
          ) : (
            <p className="local-only-message">This note has no cached server version.</p>
          )}
        </aside>
      </div>
      <CommentSection
        isServerBacked={Boolean(latestVersion)}
        noteId={note.id}
        role={workspace.role}
        workspaceId={workspace.id}
      />
    </section>
  );
}
