import { type FormEvent, useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";

import { ErrorState, LoadingState } from "../components/AsyncState";
import { useWorkspaceKey } from "../key-management/WorkspaceKeyContext";
import type { WorkspaceOutletContext } from "../layouts/WorkspaceLayout";
import { useLocalData, useLocalQuery } from "../local-storage/LocalDataContext";
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
        <div><dt>Version ID</dt><dd className="mono">{version.id}</dd></div>
        <div><dt>Parent version</dt><dd className="mono">{version.parent_version_id ?? "None"}</dd></div>
        <div><dt>Created</dt><dd>{formatDate(version.created_at)}</dd></div>
        <div><dt>Author ID</dt><dd className="mono">{version.created_by}</dd></div>
      </dl>
    </div>
  );
}

function NoteSnapshot({ payload }: { payload: LocalNotePayload | null }) {
  if (!payload) return <p className="local-only-message">No editable note snapshot is available.</p>;
  return (
    <div className="conflict-snapshot">
      <strong>{payload.title}</strong>
      <pre>{payload.body || "(Empty note body)"}</pre>
    </div>
  );
}

function resolutionLabel(resolution: ConflictResolution): string {
  if (resolution === "keep_local") return "kept the local version";
  if (resolution === "accept_remote") return "accepted the remote version";
  return "saved a manual merge";
}

export function ConflictResolutionPage() {
  const { workspace } = useOutletContext<WorkspaceOutletContext>();
  const { noteId = "" } = useParams();
  const localData = useLocalData();
  const workspaceKey = useWorkspaceKey(workspace.id);
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
    if (!conflict) return;
    setMergeTitle(conflict.local_note_payload?.title ?? "");
    setMergeBody(conflict.local_note_payload?.body ?? "");
  }, [conflict?.id]);

  useEffect(() => {
    let active = true;
    setRemotePayload(null);
    setDecryptError(null);
    if (!conflict || workspaceKey.status !== "unlocked") return () => { active = false; };

    void workspaceKey.getKey()
      .then((key) => decryptCachedNoteVersion(conflict.remote_version, key))
      .then((payload) => {
        if (active) setRemotePayload(payload);
      })
      .catch((error: unknown) => {
        if (active) {
          setDecryptError(
            error instanceof Error ? error.message : "The remote version could not be decrypted."
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
      if (resolution === "keep_local") {
        await localData.resolveConflict(conflict.id, { action: "keep_local" });
      } else if (resolution === "accept_remote") {
        if (!remotePayload) throw new Error("Unlock and decrypt the remote version first.");
        await localData.resolveConflict(conflict.id, {
          action: "accept_remote",
          remote_payload: remotePayload
        });
      } else {
        if (!mergedPayload) throw new Error("Enter the merged note content first.");
        await localData.resolveConflict(conflict.id, {
          action: "manual_merge",
          merged_payload: mergedPayload
        });
      }
      setResolvedWith(resolution);
    } catch (error) {
      setResolutionError(error instanceof Error ? error.message : "The conflict could not be resolved.");
    } finally {
      setIsResolving(false);
    }
  };

  const handleManualMerge = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void resolve("manual_merge", { body: mergeBody, title: mergeTitle.trim() });
  };

  if (conflictQuery.isLoading) return <LoadingState label="Loading conflict snapshots…" />;
  if (conflictQuery.error) return <ErrorState error={conflictQuery.error} />;
  if (resolvedWith) {
    return (
      <section className="panel conflict-complete">
        <p className="eyebrow">Conflict resolved</p>
        <h2>You {resolutionLabel(resolvedWith)}.</h2>
        <p>
          The conflicting queue entries are retired and one resolved local version is now unsynced.
          Use the workspace Sync action to encrypt and upload it.
        </p>
        <Link className="button button--primary" to={`/workspaces/${workspace.id}/notes/${noteId}`}>
          Return to note
        </Link>
      </section>
    );
  }
  if (!conflict) {
    return <ErrorState error={new Error("This note has no unresolved conflict.")} />;
  }

  const canResolve = workspace.role !== "viewer" && workspaceKey.status === "unlocked";

  return (
    <section className="conflict-detail">
      <Link className="back-link" to={`/workspaces/${workspace.id}/notes/${noteId}`}>
        ← Back to note
      </Link>
      <header className="page-header page-header--compact">
        <div>
          <p className="eyebrow">Manual conflict resolution</p>
          <h2>Choose the note content to keep</h2>
          <p>Nothing is overwritten until you explicitly save one of these choices.</p>
        </div>
        <span className="conflict-badge">Conflict unresolved</span>
      </header>

      {workspaceKey.status !== "unlocked" ? (
        <div className="warning-callout" role="status">
          Unlock the workspace above to decrypt the server version and enable resolution actions.
        </div>
      ) : null}
      {decryptError ? <div className="form-error" role="alert">{decryptError}</div> : null}
      {resolutionError ? <div className="form-error" role="alert">{resolutionError}</div> : null}

      <div className="conflict-columns">
        <section className="panel conflict-choice">
          <p className="eyebrow">Local version · revision {conflict.local_revision}</p>
          <NoteSnapshot payload={conflict.local_note_payload} />
          <button
            className="button button--secondary button--full"
            disabled={!canResolve || isResolving || !conflict.local_note_payload}
            onClick={() => void resolve("keep_local")}
            type="button"
          >
            Keep local
          </button>
        </section>

        <section className="panel conflict-choice">
          <p className="eyebrow">Remote version · server {conflict.remote_version.version_number}</p>
          {workspaceKey.status === "unlocked" && !remotePayload && !decryptError ? (
            <LoadingState label="Decrypting remote version…" />
          ) : (
            <NoteSnapshot payload={remotePayload} />
          )}
          <button
            className="button button--secondary button--full"
            disabled={!canResolve || isResolving || !remotePayload}
            onClick={() => void resolve("accept_remote")}
            type="button"
          >
            Accept remote
          </button>
        </section>
      </div>

      <section className="panel conflict-merge">
        <p className="eyebrow">Manual merge</p>
        <h2>Edit a resolved version</h2>
        <form className="form-stack" onSubmit={handleManualMerge}>
          <label>
            Title
            <input
              disabled={!canResolve || isResolving}
              maxLength={200}
              onChange={(event) => setMergeTitle(event.target.value)}
              required
              value={mergeTitle}
            />
          </label>
          <label>
            Note body
            <textarea
              disabled={!canResolve || isResolving}
              onChange={(event) => setMergeBody(event.target.value)}
              rows={16}
              value={mergeBody}
            />
          </label>
          <button
            className="button button--primary"
            disabled={!canResolve || isResolving || !mergeTitle.trim()}
          >
            {isResolving ? "Saving resolution…" : "Save manual merge"}
          </button>
        </form>
      </section>

      <section className="panel conflict-history">
        <p className="eyebrow">Conflict metadata</p>
        <div className="conflict-metadata-grid">
          <VersionMetadata label="Remote/server version" version={conflict.remote_version} />
          {conflict.base_version ? (
            <VersionMetadata label="Base version" version={conflict.base_version} />
          ) : (
            <div>
              <h3>Base version</h3>
              <p className="mono">{conflict.base_version_id ?? "No server base"}</p>
              <p>The full base-version metadata was not cached when this conflict was detected.</p>
            </div>
          )}
        </div>
        <p className="conflict-detected-at">Detected {formatDate(conflict.detected_at)}</p>
      </section>
    </section>
  );
}
