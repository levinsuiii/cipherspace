import { type PropsWithChildren, type ReactNode, useState } from "react";

import type { LegacyPlaintextInspection } from "../local-storage/types";

interface LegacyPlaintextGateProps {
  accessControls: ReactNode;
  error: string | null;
  inspection: LegacyPlaintextInspection;
  isMigrating: boolean;
  onDelete(): Promise<void>;
  onRetry(): void;
}

export function LegacyPlaintextGate({
  accessControls,
  children,
  error,
  inspection,
  isMigrating,
  onDelete,
  onRetry
}: PropsWithChildren<LegacyPlaintextGateProps>) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  if (inspection.totalRecords === 0) return <>{children}</>;

  const handleDelete = async () => {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      await onDelete();
    } catch (caught) {
      setDeleteError(
        caught instanceof Error ? caught.message : "Legacy local data could not be deleted."
      );
      setIsDeleting(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="legacy-plaintext-heading">
      <p className="eyebrow">Security action required</p>
      <h2 id="legacy-plaintext-heading">Legacy plaintext blocks this workspace</h2>
      <p>
        An older CipherSpace version left readable note data in this browser profile. Notes,
        editing, comments, conflicts, and sync stay unavailable until every affected record is
        encrypted with the original workspace key or explicitly deleted.
      </p>
      <dl>
        <div><dt>Notes</dt><dd>{inspection.notes}</dd></div>
        <div><dt>Pending changes</dt><dd>{inspection.pendingChanges}</dd></div>
        <div><dt>Conflicts</dt><dd>{inspection.conflicts}</dd></div>
      </dl>

      {accessControls}
      {isMigrating ? (
        <div className="info-callout" role="status">
          Encrypting and verifying legacy local records…
        </div>
      ) : null}
      {error ? (
        <div className="form-error" role="alert">
          {error}
          <button
            className="button button--quiet"
            disabled={isMigrating}
            onClick={onRetry}
            type="button"
          >
            Retry migration
          </button>
        </div>
      ) : null}
      {deleteError ? <div className="form-error" role="alert">{deleteError}</div> : null}

      {!confirmingDelete ? (
        <button
          className="button button--danger"
          disabled={isMigrating}
          onClick={() => setConfirmingDelete(true)}
          type="button"
        >
          Review permanent delete option
        </button>
      ) : (
        <div className="warning-callout" role="alert">
          <p>
            This permanently deletes the local note, pending-change, and conflict records for every
            affected note. Unsynced or local-only content cannot be recovered. Encrypted server
            versions can be downloaded again after cleanup. Nothing is deleted unless you confirm.
          </p>
          <div className="editor-actions">
            <button
              className="button button--danger"
              disabled={isDeleting}
              onClick={() => void handleDelete()}
              type="button"
            >
              {isDeleting ? "Deleting affected records…" : "Permanently delete affected local records"}
            </button>
            <button
              className="button button--quiet"
              disabled={isDeleting}
              onClick={() => setConfirmingDelete(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
