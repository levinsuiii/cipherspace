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
  decryptLocalNotePayload
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
          return decryptLocalNotePayload(note.local_encrypted_payload, key, {
            localRevision: note.local_revision,
            noteId: note.id,
            workspaceId: note.workspace_id
          });
        }
        if (note.local_note_payload) return note.local_note_payload;
        if (latestVersion) return decryptCachedNoteVersion(latestVersion, key);
        throw new Error("Für diese Notiz ist kein verschlüsselter Inhalt vorhanden.");
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
            "Die Notiz konnte nicht entschlüsselt werden. Möglicherweise verwendet der Workspace einen anderen Schlüssel."
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
    return <LoadingState label="Lokale Notiz wird geladen…" />;
  }
  if (!note && serverNoteQuery.isError) {
    return <ErrorState error={serverNoteQuery.error} onRetry={() => void serverNoteQuery.refetch()} />;
  }
  if (!note) return <ErrorState error={new Error("Die Notiz wurde im lokalen Speicher nicht gefunden.")} />;

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
      await localData.editEncryptedNote(note.id, payload, key);
      setSaveMessage("Lokal gespeichert. Die Änderung wartet auf die Synchronisation.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Die Notiz konnte nicht lokal gespeichert werden.");
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
      setSaveError(error instanceof Error ? error.message : "Die Notiz konnte nicht lokal gelöscht werden.");
      setIsDeleting(false);
    }
  };

  const displayTitle = workspaceKey.status === "unlocked"
    ? decryptedPayload?.title ?? shortenOpaqueValue(note.encrypted_title, "Verschlüsselte Notiz")
    : "Verschlüsselte Notiz";

  return (
    <section className="note-detail">
      <Link className="back-link" to={`/workspaces/${workspace.id}/notes`}>← Zurück zu den Notizen</Link>
      {serverNoteQuery.isError ? (
        <div className="offline-callout" role="status">
          Der Server ist nicht erreichbar. Du arbeitest mit der dauerhaft gespeicherten lokalen Kopie weiter.
        </div>
      ) : null}
      <header className="page-header page-header--compact">
        <div>
          <p className="eyebrow">Lokaler Editor</p>
          <h2>{displayTitle}</h2>
          <p>Jeder Speichervorgang aktualisiert zuerst die lokale Datenbank.</p>
        </div>
        {hasConflict ? (
          <Link
            className="conflict-badge"
            to={`/workspaces/${workspace.id}/notes/${note.id}/conflict`}
          >
            Konflikt lösen
          </Link>
        ) : (pendingCountQuery.data ?? 0) > 0 ? (
          <span className="unsynced-badge">{pendingCountQuery.data} ausstehend</span>
        ) : (
          <span className="version-badge">
            {latestVersion ? `Serverversion ${latestVersion.version_number}` : "Nur lokal"}
          </span>
        )}
      </header>

      {hasConflict ? (
        <div className="warning-callout">
          Die Bearbeitung pausiert, damit keine Fassung versehentlich überschrieben wird. Vergleiche
          die lokale Fassung mit der Serverfassung.
          {" "}<Link to={`/workspaces/${workspace.id}/notes/${note.id}/conflict`}>Konflikt öffnen</Link>
        </div>
      ) : null}

      {note.local_encrypted_payload || note.local_note_payload || latestVersion ? (
        workspaceKey.status !== "unlocked" ? (
          <div className="warning-callout" role="status">
            Diese Notiz ist auf dem Gerät verschlüsselt. Entsperre oben den Workspace-Schlüssel.
          </div>
        ) : isDecrypting ? (
          <div className="info-callout" role="status">Notiz wird im Arbeitsspeicher entschlüsselt…</div>
        ) : decryptError ? (
          <div className="form-error" role="alert">{decryptError}</div>
        ) : decryptedPayload ? (
          <div className="info-callout" role="status">
            Im Arbeitsspeicher entschlüsselt. Beim Sperren wird der lesbare Editorzustand entfernt.
          </div>
        ) : null
      ) : null}

      <div className="detail-grid">
        <section className="panel">
          <form className="form-stack note-editor" onSubmit={(event) => void handleSave(event)}>
            <label>
              Titel
              <input
                disabled={!canEdit}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={hasReadablePayload ? "Titel der Notiz" : "Zum Entschlüsseln entsperren"}
                required
                value={workspaceKey.status === "unlocked" ? title : ""}
              />
            </label>
            <label>
              Inhalt
              <textarea
                disabled={!canEdit}
                onChange={(event) => setBody(event.target.value)}
                placeholder={hasReadablePayload ? "Lokal schreiben…" : "Zum Entschlüsseln entsperren."}
                rows={18}
                value={workspaceKey.status === "unlocked" ? body : ""}
              />
            </label>
            {saveError ? <div className="form-error" role="alert">{saveError}</div> : null}
            {saveMessage ? <div className="success-callout" role="status">{saveMessage}</div> : null}
            {canEdit ? (
              <div className="editor-actions">
                <button className="button button--primary" disabled={isSaving || !title.trim()}>
                  {isSaving ? "Wird lokal gespeichert…" : "Änderung speichern"}
                </button>
                {canDelete ? (
                  <button
                    className="button button--danger"
                    disabled={isDeleting}
                    onClick={() => void handleDelete()}
                    type="button"
                  >
                    {isDeleting ? "Wird lokal gelöscht…" : "Lokal löschen"}
                  </button>
                ) : null}
              </div>
            ) : hasConflict ? (
              <Link
                className="button button--primary"
                to={`/workspaces/${workspace.id}/notes/${note.id}/conflict`}
              >
                Konflikt lösen
              </Link>
            ) : workspace.role === "viewer" ? (
              <p className="read-only-message">Als Leser kannst du diese Notiz nicht bearbeiten.</p>
            ) : (
              <p className="read-only-message">Entsperre und entschlüssle die Notiz vor dem Bearbeiten.</p>
            )}
          </form>
        </section>
        <aside className="panel workspace-summary">
          <h3>Lokaler Datensatz</h3>
          <dl>
            <div><dt>Aktualisiert</dt><dd>{formatDate(note.updated_at)}</dd></div>
            <div><dt>Lokale Revision</dt><dd>{note.local_revision}</dd></div>
            <div><dt>Basisversions-ID</dt><dd className="mono">{note.base_version_id ?? "Nur lokal"}</dd></div>
            <div><dt>Notiz-ID</dt><dd className="mono">{note.id}</dd></div>
          </dl>
          {latestVersion ? (
            <details className="cached-envelope">
              <summary>Gespeicherter Server-Umschlag</summary>
              <dl>
                <div><dt>Version</dt><dd>{latestVersion.version_number}</dd></div>
                <div><dt>Algorithmus</dt><dd>{latestVersion.encryption_algorithm}</dd></div>
                <div><dt>Schlüssel-ID</dt><dd className="mono">{latestVersion.key_id}</dd></div>
              </dl>
            </details>
          ) : (
            <p className="local-only-message">Für diese Notiz ist keine Serverversion gespeichert.</p>
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
