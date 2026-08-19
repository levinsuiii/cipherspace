import { useQuery } from "@tanstack/react-query";
import { Link, useOutletContext, useParams } from "react-router-dom";

import { api } from "../api/client";
import { ErrorState, LoadingState } from "../components/AsyncState";
import type { WorkspaceOutletContext } from "../layouts/WorkspaceLayout";
import { queryKeys } from "../queryKeys";
import { formatDate, shortenOpaqueValue } from "../utils";

export function NoteDetailPage() {
  const { workspace } = useOutletContext<WorkspaceOutletContext>();
  const { noteId = "" } = useParams();
  const noteQuery = useQuery({
    enabled: Boolean(noteId),
    queryKey: queryKeys.note(workspace.id, noteId),
    queryFn: () => api.notes.get(workspace.id, noteId)
  });

  if (noteQuery.isLoading) return <LoadingState label="Loading note envelope…" />;
  if (noteQuery.isError) {
    return <ErrorState error={noteQuery.error} onRetry={() => void noteQuery.refetch()} />;
  }
  if (!noteQuery.data) return <ErrorState error={new Error("Note not found.")} />;

  const { latestVersion, note } = noteQuery.data;
  return (
    <section className="note-detail">
      <Link className="back-link" to={`/workspaces/${workspace.id}/notes`}>← Back to notes</Link>
      <header className="page-header page-header--compact">
        <div>
          <p className="eyebrow">Encrypted note envelope</p>
          <h2>{shortenOpaqueValue(note.encryptedTitle, "Untitled encrypted note")}</h2>
          <p>This shell displays server-visible metadata and the latest opaque payload only.</p>
        </div>
        <span className="version-badge">Version {latestVersion.versionNumber}</span>
      </header>

      <div className="detail-grid">
        <section className="panel envelope-panel">
          <h3>Latest encrypted payload</h3>
          <dl>
            <div><dt>Encrypted content</dt><dd><code>{latestVersion.encryptedContent}</code></dd></div>
            <div><dt>Content nonce</dt><dd><code>{latestVersion.contentNonce}</code></dd></div>
            <div><dt>Algorithm label</dt><dd>{latestVersion.encryptionMetadata.algorithm}</dd></div>
            <div><dt>Envelope version</dt><dd>{latestVersion.encryptionMetadata.envelopeVersion}</dd></div>
            <div><dt>Key ID</dt><dd><code>{latestVersion.encryptionMetadata.keyId}</code></dd></div>
          </dl>
        </section>
        <aside className="panel workspace-summary">
          <h3>Record metadata</h3>
          <dl>
            <div><dt>Updated</dt><dd>{formatDate(note.updatedAt)}</dd></div>
            <div><dt>Created by</dt><dd className="mono">{note.createdBy}</dd></div>
            <div><dt>Note ID</dt><dd className="mono">{note.id}</dd></div>
            <div><dt>Version ID</dt><dd className="mono">{latestVersion.id}</dd></div>
            <div><dt>Client version</dt><dd>{latestVersion.clientVersion ?? "Not supplied"}</dd></div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
