import { type FormEvent, useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";

import { ErrorState, LoadingState } from "../components/AsyncState";
import { useWorkspaceKey } from "../key-management/WorkspaceKeyContext";
import type { WorkspaceOutletContext } from "../layouts/WorkspaceLayout";
import { useLocalData, useLocalQuery } from "../local-storage/LocalDataContext";
import {
  decryptLocalNotePayload
} from "../local-storage/notePayloadCrypto";
import type {
  ConflictResolution,
  LocalNotePayload,
  LocalNoteVersion
} from "../local-storage/types";
import { decryptCachedNoteVersion } from "../sync/crypto";
import { formatDate } from "../utils";

function VersionMetadata({ label, version }: { label: string; version: LocalNoteVersion }) {
  return (
    <div className="conflict-version-metadata">
      <h3>{label}</h3>
      <dl>
        <div><dt>Version</dt><dd>{version.version_number}</dd></div>
        <div><dt>Versions-ID</dt><dd className="mono">{version.id}</dd></div>
        <div><dt>Vorgängerversion</dt><dd className="mono">{version.parent_version_id ?? "Keine"}</dd></div>
        <div><dt>Erstellt</dt><dd>{formatDate(version.created_at)}</dd></div>
        <div><dt>Autor-ID</dt><dd className="mono">{version.created_by}</dd></div>
      </dl>
    </div>
  );
}

function NoteSnapshot({ payload }: { payload: LocalNotePayload | null }) {
  if (!payload) return <p className="local-only-message">Keine bearbeitbare Fassung verfügbar.</p>;
  return (
    <div className="conflict-snapshot">
      <strong>{payload.title}</strong>
      <pre>{payload.body || "(Notiz ohne Inhalt)"}</pre>
    </div>
  );
}

function resolutionLabel(resolution: ConflictResolution): string {
  if (resolution === "keep_local") return "Lokale Fassung beibehalten";
  if (resolution === "accept_remote") return "Serverfassung übernommen";
  return "Zusammengeführte Fassung gespeichert";
}

export function ConflictResolutionPage() {
  const { workspace } = useOutletContext<WorkspaceOutletContext>();
  const { noteId = "" } = useParams();
  const localData = useLocalData();
  const workspaceKey = useWorkspaceKey(workspace.id);
  const [localPayload, setLocalPayload] = useState<LocalNotePayload | null>(null);
  const [remotePayload, setRemotePayload] = useState<LocalNotePayload | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [mergeBody, setMergeBody] = useState("");
  const [mergeTitle, setMergeTitle] = useState("");
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [resolvedWith, setResolvedWith] = useState<ConflictResolution | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const conflictQuery = useLocalQuery(
    () => localData.getUnresolvedConflictForNote(noteId),
    [localData, noteId]
  );
  const conflict = conflictQuery.data;

  useEffect(() => {
    let active = true;
    setLocalPayload(null);
    setRemotePayload(null);
    setDecryptError(null);
    setMergeBody("");
    setMergeTitle("");
    if (!conflict || workspaceKey.status !== "unlocked") return () => { active = false; };

    void workspaceKey.getKey()
      .then(async (key) => {
        const local = conflict.local_encrypted_payload
          ? await decryptLocalNotePayload(conflict.local_encrypted_payload, key, {
              localRevision: conflict.local_revision,
              noteId: conflict.note_id,
              workspaceId: conflict.workspace_id
            })
          : conflict.local_note_payload;
        const remote = await decryptCachedNoteVersion(conflict.remote_version, key);
        return { local, remote };
      })
      .then(({ local, remote }) => {
        if (!active) return;
        setLocalPayload(local);
        setRemotePayload(remote);
        setMergeTitle(local?.title ?? "");
        setMergeBody(local?.body ?? "");
      })
      .catch((error: unknown) => {
        if (active) {
          setDecryptError(
            error instanceof Error ? error.message : "Die Serverfassung konnte nicht entschlüsselt werden."
          );
        }
      });
    return () => { active = false; };
  }, [conflict?.id, workspaceKey.getKey, workspaceKey.status]);

  const resolve = async (
    resolution: ConflictResolution,
    mergedPayload?: LocalNotePayload
  ) => {
    if (!conflict) return;
    setResolutionError(null);
    setIsResolving(true);
    try {
      const key = await workspaceKey.getKey();
      if (resolution === "keep_local") {
        if (!localPayload) throw new Error("Entsperre und entschlüssle zuerst die lokale Fassung.");
        await localData.resolveEncryptedConflict(
          conflict.id,
          { action: "keep_local" },
          localPayload,
          key
        );
      } else if (resolution === "accept_remote") {
        if (!remotePayload) throw new Error("Entsperre und entschlüssle zuerst die Serverfassung.");
        await localData.resolveEncryptedConflict(
          conflict.id,
          { action: "accept_remote", remote_payload: remotePayload },
          remotePayload,
          key
        );
      } else {
        if (!mergedPayload) throw new Error("Gib zuerst den zusammengeführten Inhalt ein.");
        await localData.resolveEncryptedConflict(
          conflict.id,
          { action: "manual_merge", merged_payload: mergedPayload },
          mergedPayload,
          key
        );
      }
      setResolvedWith(resolution);
    } catch (error) {
      setResolutionError(error instanceof Error ? error.message : "Der Konflikt konnte nicht gelöst werden.");
    } finally {
      setIsResolving(false);
    }
  };

  const handleManualMerge = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void resolve("manual_merge", { body: mergeBody, title: mergeTitle.trim() });
  };

  if (conflictQuery.isLoading) return <LoadingState label="Konfliktfassungen werden geladen…" />;
  if (conflictQuery.error) return <ErrorState error={conflictQuery.error} />;
  if (resolvedWith) {
    return (
      <section className="panel conflict-complete">
        <p className="eyebrow">Konflikt gelöst</p>
        <h2>{resolutionLabel(resolvedWith)}</h2>
        <p>
          Die widersprüchlichen Einträge wurden ersetzt. Eine gelöste lokale Fassung wartet jetzt
          auf die Synchronisation.
        </p>
        <Link className="button button--primary" to={`/workspaces/${workspace.id}/notes/${noteId}`}>
          Zurück zur Notiz
        </Link>
      </section>
    );
  }
  if (!conflict) {
    return <ErrorState error={new Error("Für diese Notiz liegt kein ungelöster Konflikt vor.")} />;
  }

  const canResolve = workspace.role !== "viewer" && workspaceKey.status === "unlocked";

  return (
    <section className="conflict-detail">
      <Link className="back-link" to={`/workspaces/${workspace.id}/notes/${noteId}`}>
        ← Zurück zur Notiz
      </Link>
      <header className="page-header page-header--compact">
        <div>
          <p className="eyebrow">Manuelle Konfliktlösung</p>
          <h2>Wähle die Fassung, die erhalten bleiben soll</h2>
          <p>Erst beim Speichern wird eine der Fassungen übernommen.</p>
        </div>
        <span className="conflict-badge">Konflikt offen</span>
      </header>

      {workspaceKey.status !== "unlocked" ? (
        <div className="warning-callout" role="status">
          Entsperre oben den Workspace, um die Serverfassung zu entschlüsseln.
        </div>
      ) : null}
      {decryptError ? <div className="form-error" role="alert">{decryptError}</div> : null}
      {resolutionError ? <div className="form-error" role="alert">{resolutionError}</div> : null}

      <div className="conflict-columns">
        <section className="panel conflict-choice">
          <p className="eyebrow">Lokale Fassung · Revision {conflict.local_revision}</p>
          <NoteSnapshot payload={workspaceKey.status === "unlocked" ? localPayload : null} />
          <button
            className="button button--secondary button--full"
            disabled={!canResolve || isResolving || !localPayload}
            onClick={() => void resolve("keep_local")}
            type="button"
          >
            Lokal beibehalten
          </button>
        </section>

        <section className="panel conflict-choice">
          <p className="eyebrow">Serverfassung · Version {conflict.remote_version.version_number}</p>
          {workspaceKey.status === "unlocked" && !remotePayload && !decryptError ? (
            <LoadingState label="Serverfassung wird entschlüsselt…" />
          ) : (
            <NoteSnapshot
              payload={workspaceKey.status === "unlocked" ? remotePayload : null}
            />
          )}
          <button
            className="button button--secondary button--full"
            disabled={!canResolve || isResolving || !remotePayload}
            onClick={() => void resolve("accept_remote")}
            type="button"
          >
            Serverfassung übernehmen
          </button>
        </section>
      </div>

      <section className="panel conflict-merge">
        <p className="eyebrow">Manuell zusammenführen</p>
        <h2>Gemeinsame Fassung bearbeiten</h2>
        <form className="form-stack" onSubmit={handleManualMerge}>
          <label>
            Titel
            <input
              disabled={!canResolve || isResolving}
              maxLength={200}
              onChange={(event) => setMergeTitle(event.target.value)}
              required
              value={workspaceKey.status === "unlocked" ? mergeTitle : ""}
            />
          </label>
          <label>
            Inhalt
            <textarea
              disabled={!canResolve || isResolving}
              onChange={(event) => setMergeBody(event.target.value)}
              rows={16}
              value={workspaceKey.status === "unlocked" ? mergeBody : ""}
            />
          </label>
          <button
            className="button button--primary"
            disabled={!canResolve || isResolving || !mergeTitle.trim()}
          >
            {isResolving ? "Lösung wird gespeichert…" : "Zusammenführung speichern"}
          </button>
        </form>
      </section>

      <section className="panel conflict-history">
        <p className="eyebrow">Konflikt-Metadaten</p>
        <div className="conflict-metadata-grid">
          <VersionMetadata label="Serverfassung" version={conflict.remote_version} />
          {conflict.base_version ? (
            <VersionMetadata label="Basisversion" version={conflict.base_version} />
          ) : (
            <div>
              <h3>Basisversion</h3>
              <p className="mono">{conflict.base_version_id ?? "Keine Serverbasis"}</p>
              <p>Beim Erkennen des Konflikts waren nicht alle Metadaten der Basisversion gespeichert.</p>
            </div>
          )}
        </div>
        <p className="conflict-detected-at">Erkannt am {formatDate(conflict.detected_at)}</p>
      </section>
    </section>
  );
}
