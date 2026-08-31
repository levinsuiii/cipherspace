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
  onCreateKey(passphrase: string): Promise<void>;
  onLock(): void;
  onSync(): Promise<SyncSummary>;
  onSetupShared(identityPassword: string, passphrase: string): Promise<void>;
  onUnlock(passphrase: string): Promise<void>;
  pendingCount: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof WorkspaceLockedError) return error.message;
  if (error instanceof TypeError) {
    return "Server unavailable. Check that the backend is running, then try again.";
  }
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The operation failed. Please try again.";
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
      setError("The unlock passwords do not match.");
      return;
    }
    setIsSubmittingKey(true);
    try {
      if (keyStatus === "missing" && keyAccess?.keyShareAvailable) {
        await onSetupShared(identityPassword, passphrase);
      } else if (keyStatus === "missing" && legacyMigrationRequired) {
        throw new Error(
          "The original workspace key is required. CipherSpace will not create a replacement key for legacy local data."
        );
      } else if (keyStatus === "missing" && keyAccess?.canInitialize) {
        await onCreateKey(passphrase);
      }
      else await onUnlock(passphrase);
      setIdentityPassword("");
      setPassphrase("");
      setConfirmPassphrase("");
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
    <section className="sync-panel" aria-label="Workspace synchronization">
      <div className="sync-panel__status">
        <div>
          <span className={`sync-status sync-status--${visibleStatus}`} role="status">
            {legacyMigrationRequired ? "migration required" : visibleStatus}
          </span>
          <strong>
            {legacyMigrationRequired ? "Legacy local-data migration" : "Encrypted sync"}
          </strong>
        </div>
        <p>
          {legacyMigrationRequired && keyStatus === "unlocked"
            ? "The original workspace key is unlocked. CipherSpace is verifying and encrypting every legacy local record before workspace access resumes."
            : keyStatus === "missing"
            ? keyAccess === null
              ? "Checking whether this workspace can be initialized or has a key share…"
              : keyAccess.keyShareAvailable
              ? "Set up encrypted workspace access from your personal key share."
              : keyAccess.canInitialize
                ? "Create the first stable key for this new empty workspace."
                : "This device has no local key and no encrypted key share is available."
            : keyStatus === "locked"
              ? "Unlock the local workspace key to encrypt and sync pending notes."
              : keyStatus === "checking"
                ? "Checking this device for a protected workspace key…"
                : conflictCount > 0
                  ? `${conflictCount} conflict${conflictCount === 1 ? " needs" : "s need"} manual resolution.`
                : pendingCount > 0
                  ? `${pendingCount} local change${pendingCount === 1 ? "" : "s"} ready to sync.`
                  : "Local changes are synced. You can also pull remote updates manually."}
        </p>
      </div>

      {keyStatus === "missing" && keyAccess === null ? (
        <div className="info-callout" role="status">Checking encrypted access…</div>
      ) : keyStatus === "missing" && keyAccess?.keyShareAvailable ? (
        <form className="sync-key-form" onSubmit={(event) => void handleKeySubmit(event)}>
          <label>
            Account password
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
            New local unlock password
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
            Confirm unlock password
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
            {isSubmittingKey ? "Setting up…" : "Set up encrypted workspace access"}
          </button>
          <small>
            Your account password unlocks your client-only identity key. Choose an independent
            password for this workspace on this browser; neither password is shared with the owner.
          </small>
        </form>
      ) : keyStatus === "missing" && legacyMigrationRequired ? (
        <div className="warning-callout" role="status">
          The original workspace key is not available on this device. CipherSpace will not create
          a replacement key because it could not decrypt this legacy data. Restore the existing key
          share if possible, or use the explicit delete option below.
        </div>
      ) : keyStatus === "missing" && !keyAccess?.canInitialize ? (
        <div className="warning-callout" role="status">
          Ask a workspace owner to create or refresh your encrypted workspace key share. Do not
          create a replacement key for an existing workspace.
        </div>
      ) : keyStatus === "missing" || keyStatus === "locked" ? (
        <form className="sync-key-form" onSubmit={(event) => void handleKeySubmit(event)}>
          <label>
            Local unlock password
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
              Confirm unlock password
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
              ? "Unlocking…"
              : keyStatus === "missing"
                ? "Create and unlock key"
                : "Unlock workspace"}
          </button>
          {keyStatus === "missing" ? (
            <small>
              This initializes the workspace once. The password stays on this browser profile;
              there is no identity or workspace-key recovery in v1.
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
            {syncStatus === "syncing" ? "Syncing…" : "Sync"}
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
            Lock
          </button>
        </div>
      ) : null}

      {error ? <div className="form-error" role="alert">{error}</div> : null}
    </section>
  );
}
