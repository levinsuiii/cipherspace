import { type FormEvent, useEffect, useState } from "react";

import { ApiError } from "../api/client";
import {
  WorkspaceLockedError,
  type WorkspaceKeyStatus
} from "../key-management/WorkspaceKeyContext";
import type { SyncSummary } from "../sync/engine";
import type { WorkspaceKeyAccess } from "../api/types";

type SyncStatus = "conflict" | "failed" | "idle" | "locked" | "synced" | "syncing";

interface WorkspaceSyncControlsProps {
  conflictCount: number;
  keyStatus: WorkspaceKeyStatus;
  keyAccess: WorkspaceKeyAccess | null;
  legacyMigrationRequired?: boolean;
  onCreateKey(identityPassword: string, passphrase: string): Promise<void>;
  onLock(): void;
  onSync(): Promise<SyncSummary>;
  onSetupShared(identityPassword: string, passphrase: string, senderVerificationCode: string): Promise<void>;
  onUnlock(passphrase: string): Promise<void>;
  pendingCount: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof WorkspaceLockedError) return error.message;
  if (error instanceof TypeError) {
    return "Der Server ist nicht erreichbar. Prüfe die Verbindung und versuche es erneut.";
  }
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Der Vorgang ist fehlgeschlagen. Versuche es erneut.";
}

export function WorkspaceSyncControls({
  conflictCount,
  keyStatus,
  keyAccess,
  legacyMigrationRequired = false,
  onCreateKey,
  onLock,
  onSync,
  onSetupShared,
  onUnlock,
  pendingCount
}: WorkspaceSyncControlsProps) {
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmittingKey, setIsSubmittingKey] = useState(false);
  const [identityPassword, setIdentityPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [senderVerificationCode, setSenderVerificationCode] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");

  const locked = keyStatus !== "unlocked";
  const visibleStatus: SyncStatus = locked ? "locked" : syncStatus;

  useEffect(() => {
    if (pendingCount > 0 && syncStatus === "synced") setSyncStatus("idle");
    if (conflictCount === 0 && syncStatus === "conflict") setSyncStatus("idle");
  }, [conflictCount, pendingCount, syncStatus]);

  const handleKeySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (keyStatus === "missing" && passphrase !== confirmPassphrase) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    setIsSubmittingKey(true);
    try {
      if (keyStatus === "missing" && keyAccess?.keyShareAvailable) {
        await onSetupShared(identityPassword, passphrase, senderVerificationCode.trim());
      } else if (keyStatus === "missing" && legacyMigrationRequired) {
        throw new Error(
          "Der ursprüngliche Workspace-Schlüssel ist erforderlich. Für ältere lokale Daten wird kein Ersatzschlüssel erstellt."
        );
      } else if (keyStatus === "missing" && keyAccess?.canInitialize) {
        await onCreateKey(identityPassword, passphrase);
      }
      else await onUnlock(passphrase);
      setIdentityPassword("");
      setPassphrase("");
      setConfirmPassphrase("");
      setSenderVerificationCode("");
      setSyncStatus("idle");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSubmittingKey(false);
    }
  };

  const handleSync = async () => {
    setError(null);
    setSyncStatus("syncing");
    try {
      const summary = await onSync();
      setSyncStatus(summary.conflicts > 0 ? "conflict" : "synced");
    } catch (caught) {
      setError(errorMessage(caught));
      setSyncStatus(caught instanceof WorkspaceLockedError ? "locked" : "failed");
    }
  };

  return (
    <section className="sync-panel" aria-label="Workspace-Synchronisation">
      <div className="sync-panel__status">
        <div>
          <span className={`sync-status sync-status--${visibleStatus}`} role="status">
            {legacyMigrationRequired ? "Migration nötig" : ({ idle: "bereit", syncing: "Abgleich", synced: "aktuell", conflict: "Konflikt", failed: "Fehler", locked: "gesperrt" } as const)[visibleStatus]}
          </span>
          <strong>
            {legacyMigrationRequired ? "Migration lokaler Bestandsdaten" : "Verschlüsselte Synchronisation"}
          </strong>
        </div>
        <p>
          {legacyMigrationRequired && keyStatus === "unlocked"
            ? "Der ursprüngliche Schlüssel ist entsperrt. CipherSpace prüft und verschlüsselt jetzt alle älteren lokalen Datensätze."
            : keyStatus === "missing"
            ? keyAccess === null
              ? "Verschlüsselter Zugriff wird geprüft…"
              : keyAccess.keyShareAvailable
              ? keyAccess.keyShareProtocolVersion === 2
                ? "Richte den Zugriff mit deiner persönlichen Schlüsselfreigabe ein."
                : "Deine ältere Schlüsselfreigabe muss von einem verifizierten Besitzer neu ausgestellt werden."
              : keyAccess.canInitialize
                ? "Erstelle den ersten Schlüssel für diesen noch leeren Workspace."
                : "Auf diesem Gerät ist weder ein lokaler Schlüssel noch eine Freigabe vorhanden."
            : keyStatus === "locked"
              ? "Entsperre den lokalen Workspace-Schlüssel zum Verschlüsseln und Synchronisieren."
              : keyStatus === "checking"
                ? "Geschützter Workspace-Schlüssel wird gesucht…"
                : conflictCount > 0
                  ? `${conflictCount} ${conflictCount === 1 ? "Konflikt muss" : "Konflikte müssen"} manuell gelöst werden.`
                : pendingCount > 0
                  ? `${pendingCount} lokale ${pendingCount === 1 ? "Änderung wartet" : "Änderungen warten"} auf den Abgleich.`
                  : "Lokale Änderungen sind abgeglichen. Serveränderungen können manuell geladen werden."}
        </p>
      </div>

      {keyStatus === "missing" && keyAccess === null ? (
        <div className="info-callout" role="status">Verschlüsselter Zugriff wird geprüft…</div>
      ) : keyStatus === "missing" && keyAccess?.keyShareAvailable && keyAccess.keyShareProtocolVersion === 2 ? (
        <form className="sync-key-form" onSubmit={(event) => void handleKeySubmit(event)}>
          <label>
            Account-Passwort
            <input
              autoComplete="current-password"
              disabled={isSubmittingKey}
              maxLength={128}
              minLength={12}
              onChange={(event) => setIdentityPassword(event.target.value)}
              required
              type="password"
              value={identityPassword}
            />
          </label>
          <label>
            Verifizierungscode des Workspace-Besitzers
            <textarea
              disabled={isSubmittingKey}
              onChange={(event) => setSenderVerificationCode(event.target.value)}
              placeholder="cipherspace-verify:…"
              rows={3}
              value={senderVerificationCode}
            />
            <small>Übernimm diesen Code über einen anderen, vertrauenswürdigen Kanal – nicht aus CipherSpace selbst.</small>
          </label>
          <label>
            Neues lokales Entsperrpasswort
            <input
              autoComplete="new-password"
              disabled={isSubmittingKey}
              maxLength={128}
              minLength={12}
              onChange={(event) => setPassphrase(event.target.value)}
              required
              type="password"
              value={passphrase}
            />
          </label>
          <label>
            Entsperrpasswort bestätigen
            <input
              autoComplete="new-password"
              disabled={isSubmittingKey}
              maxLength={128}
              minLength={12}
              onChange={(event) => setConfirmPassphrase(event.target.value)}
              required
              type="password"
              value={confirmPassphrase}
            />
          </label>
          <button className="button button--primary" disabled={isSubmittingKey} type="submit">
            {isSubmittingKey ? "Wird eingerichtet…" : "Verschlüsselten Zugriff einrichten"}
          </button>
          <small>
            Das Account-Passwort entsperrt nur deinen lokalen Identitätsschlüssel. Wähle für
            diesen Workspace ein eigenes Passwort; keines davon wird mit dem Besitzer geteilt.
          </small>
        </form>
      ) : keyStatus === "missing" && keyAccess?.keyShareAvailable ? (
        <div className="warning-callout" role="status">
          Diese ältere, unsignierte Schlüsselfreigabe wird nicht entschlüsselt. Bitte einen bereits
          verifizierten Workspace-Besitzer, sie als signierte Version 2 neu auszustellen.
        </div>
      ) : keyStatus === "missing" && legacyMigrationRequired ? (
        <div className="warning-callout" role="status">
          Der ursprüngliche Workspace-Schlüssel fehlt auf diesem Gerät. Ein Ersatzschlüssel könnte
          die älteren Daten nicht entschlüsseln. Stelle die vorhandene Freigabe wieder her oder
          nutze unten die ausdrückliche Löschoption.
        </div>
      ) : keyStatus === "missing" && !keyAccess?.canInitialize ? (
        <div className="warning-callout" role="status">
          Bitte einen Workspace-Besitzer, deine verschlüsselte Schlüsselfreigabe zu erstellen oder
          zu erneuern.
        </div>
      ) : keyStatus === "missing" || keyStatus === "locked" ? (
        <form className="sync-key-form" onSubmit={(event) => void handleKeySubmit(event)}>
          {keyStatus === "missing" && keyAccess?.canInitialize ? (
            <label>
              Account-Passwort für die digitale Signatur
              <input
                autoComplete="current-password"
                disabled={isSubmittingKey}
                maxLength={128}
                minLength={12}
                onChange={(event) => setIdentityPassword(event.target.value)}
                required
                type="password"
                value={identityPassword}
              />
            </label>
          ) : null}
          <label>
            Lokales Entsperrpasswort
            <input
              autoComplete={keyStatus === "missing" ? "new-password" : "current-password"}
              disabled={isSubmittingKey}
              maxLength={128}
              minLength={12}
              onChange={(event) => setPassphrase(event.target.value)}
              required
              type="password"
              value={passphrase}
            />
          </label>
          {keyStatus === "missing" ? (
            <label>
              Entsperrpasswort bestätigen
              <input
                autoComplete="new-password"
                disabled={isSubmittingKey}
                maxLength={128}
                minLength={12}
                onChange={(event) => setConfirmPassphrase(event.target.value)}
                required
                type="password"
                value={confirmPassphrase}
              />
            </label>
          ) : null}
          <button className="button button--primary" disabled={isSubmittingKey} type="submit">
            {isSubmittingKey
              ? "Wird entsperrt…"
              : keyStatus === "missing"
                ? "Schlüssel erstellen und entsperren"
                : "Workspace entsperren"}
          </button>
          {keyStatus === "missing" ? (
            <small>
              Damit wird der Workspace einmalig eingerichtet. Das Passwort bleibt in diesem
              Browserprofil; eine Wiederherstellung ist in dieser Version nicht möglich.
            </small>
          ) : null}
        </form>
      ) : null}

      {keyStatus === "unlocked" && !legacyMigrationRequired ? (
        <div className="sync-panel__actions">
          <button
            className="button button--primary"
            disabled={syncStatus === "syncing"}
            onClick={() => void handleSync()}
            type="button"
          >
            {syncStatus === "syncing" ? "Wird synchronisiert…" : "Synchronisieren"}
          </button>
          <button
            className="button button--quiet"
            disabled={syncStatus === "syncing"}
            onClick={() => {
              onLock();
              setSyncStatus("locked");
              setError(null);
            }}
            type="button"
          >
            Sperren
          </button>
        </div>
      ) : null}

      {error ? <div className="form-error" role="alert">{error}</div> : null}
    </section>
  );
}
