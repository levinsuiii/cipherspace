import { type FormEvent, useEffect, useState } from "react";

import { ApiError } from "../api/client";
import {
  WorkspaceLockedError,
  type WorkspaceKeyStatus
} from "../key-management/WorkspaceKeyContext";
import type { SyncSummary } from "../sync/engine";

type SyncStatus = "failed" | "idle" | "locked" | "synced" | "syncing";

interface WorkspaceSyncControlsProps {
  keyStatus: WorkspaceKeyStatus;
  onCreateKey(passphrase: string): Promise<void>;
  onLock(): void;
  onSync(): Promise<SyncSummary>;
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
  keyStatus,
  onCreateKey,
  onLock,
  onSync,
  onUnlock,
  pendingCount
}: WorkspaceSyncControlsProps) {
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmittingKey, setIsSubmittingKey] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");

  const locked = keyStatus !== "unlocked";
  const visibleStatus: SyncStatus = locked ? "locked" : syncStatus;

  useEffect(() => {
    if (pendingCount > 0 && syncStatus === "synced") setSyncStatus("idle");
  }, [pendingCount, syncStatus]);

  const handleKeySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (keyStatus === "missing" && passphrase !== confirmPassphrase) {
      setError("The unlock passwords do not match.");
      return;
    }
    setIsSubmittingKey(true);
    try {
      if (keyStatus === "missing") await onCreateKey(passphrase);
      else await onUnlock(passphrase);
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
      await onSync();
      setSyncStatus("synced");
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
            {visibleStatus}
          </span>
          <strong>Encrypted sync</strong>
        </div>
        <p>
          {keyStatus === "missing"
            ? "Create a stable local workspace key before the first sync."
            : keyStatus === "locked"
              ? "Unlock the local workspace key to encrypt and sync pending notes."
              : keyStatus === "checking"
                ? "Checking this device for a protected workspace key…"
                : pendingCount > 0
                  ? `${pendingCount} local change${pendingCount === 1 ? "" : "s"} ready to sync.`
                  : "Local changes are synced. You can also pull remote updates manually."}
        </p>
      </div>

      {keyStatus === "missing" || keyStatus === "locked" ? (
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
              This password and key stay on this browser profile. There is no recovery or
              multi-device key sharing in v1.
            </small>
          ) : null}
        </form>
      ) : null}

      {keyStatus === "unlocked" ? (
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
