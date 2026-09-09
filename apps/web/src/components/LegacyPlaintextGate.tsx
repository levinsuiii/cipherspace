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
        caught instanceof Error ? caught.message : "Ältere lokale Daten konnten nicht gelöscht werden."
      );
      setIsDeleting(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="legacy-plaintext-heading">
      <p className="eyebrow">Sicherheitsaktion erforderlich</p>
      <h2 id="legacy-plaintext-heading">Ältere Klartextdaten blockieren den Workspace</h2>
      <p>
        Eine ältere CipherSpace-Version hat lesbare Notizdaten in diesem Browserprofil gespeichert.
        Der Workspace bleibt gesperrt, bis alle betroffenen Datensätze mit dem ursprünglichen
        Schlüssel verschlüsselt oder ausdrücklich gelöscht wurden.
      </p>
      <dl>
        <div><dt>Notizen</dt><dd>{inspection.notes}</dd></div>
        <div><dt>Ausstehende Änderungen</dt><dd>{inspection.pendingChanges}</dd></div>
        <div><dt>Konflikte</dt><dd>{inspection.conflicts}</dd></div>
      </dl>

      {accessControls}
      {isMigrating ? (
        <div className="info-callout" role="status">
          Ältere lokale Datensätze werden verschlüsselt und geprüft…
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
            Migration erneut versuchen
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
          Dauerhaftes Löschen prüfen
        </button>
      ) : (
        <div className="warning-callout" role="alert">
          <p>
            Dadurch werden lokale Notizen, ausstehende Änderungen und Konflikte dauerhaft gelöscht.
            Nur lokal vorhandene Inhalte können nicht wiederhergestellt werden. Verschlüsselte
            Serverversionen lassen sich danach erneut laden.
          </p>
          <div className="editor-actions">
            <button
              className="button button--danger"
              disabled={isDeleting}
              onClick={() => void handleDelete()}
              type="button"
            >
              {isDeleting ? "Datensätze werden gelöscht…" : "Betroffene lokale Datensätze löschen"}
            </button>
            <button
              className="button button--quiet"
              disabled={isDeleting}
              onClick={() => setConfirmingDelete(false)}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
