import { type ChangeEvent, type FormEvent, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { EncryptionIdentitySetup } from "../components/EncryptionIdentitySetup";
import {
  exportLocalUserRecoveryKit,
  importLocalUserRecoveryKit,
  parseRecoveryKitText
} from "../key-management/recovery";
import type { UserCryptoIdentityStatus } from "../key-management/userIdentity";

function identityStatusLabel(status: UserCryptoIdentityStatus): string {
  switch (status) {
    case "ready":
      return "Available locally and registered";
    case "missing-unregistered":
      return "First-device setup required";
    case "local-unregistered":
      return "Public key registration incomplete";
    case "missing-registered":
      return "Recovery kit required on this device";
    case "identity-mismatch":
      return "Local identity does not match account";
    case "error":
      return "Status unavailable";
    default:
      return "Checking…";
  }
}

export function AccountRecoveryPage() {
  const { identityRestored, user } = useAuth();
  const [identityStatus, setIdentityStatus] = useState<UserCryptoIdentityStatus>("checking");
  const [identityRefreshToken, setIdentityRefreshToken] = useState(0);
  const [accountPassword, setAccountPassword] = useState("");
  const [recoveryPassphrase, setRecoveryPassphrase] = useState("");
  const [recoveryConfirmation, setRecoveryConfirmation] = useState("");
  const [kitText, setKitText] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importAccountPassword, setImportAccountPassword] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  if (!user) return null;

  const hasLocalIdentity =
    identityStatus === "ready" ||
    identityStatus === "local-unregistered" ||
    identityStatus === "identity-mismatch";

  const createKit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setExportError(null);
    setExportSuccess(null);
    if (recoveryPassphrase !== recoveryConfirmation) {
      setExportError("The recovery passphrases do not match.");
      return;
    }
    setIsExporting(true);
    try {
      const kit = await exportLocalUserRecoveryKit(
        user.id,
        accountPassword,
        recoveryPassphrase
      );
      setKitText(JSON.stringify(kit, null, 2));
      setAccountPassword("");
      setRecoveryPassphrase("");
      setRecoveryConfirmation("");
      setExportSuccess("Encrypted recovery kit created locally. Save it somewhere private.");
    } catch (error) {
      setKitText("");
      setExportError(error instanceof Error ? error.message : "Recovery kit export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const downloadKit = () => {
    if (!kitText) return;
    const blobUrl = URL.createObjectURL(new Blob([kitText], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `cipherspace-recovery-${user.id}.json`;
    anchor.click();
    URL.revokeObjectURL(blobUrl);
  };

  const copyKit = async () => {
    setExportError(null);
    try {
      await navigator.clipboard.writeText(kitText);
      setExportSuccess("Encrypted recovery kit copied to the clipboard.");
    } catch {
      setExportError("Clipboard access failed. Select and copy the recovery kit text manually.");
    }
  };

  const readKitFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      setImportText(await file.text());
    } catch {
      setImportError("The selected recovery kit file could not be read.");
    }
  };

  const importKit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setImportError(null);
    setImportSuccess(null);
    setIsImporting(true);
    try {
      await importLocalUserRecoveryKit({
        accountPassword: importAccountPassword,
        kit: parseRecoveryKitText(importText),
        overwriteExisting: hasLocalIdentity && confirmOverwrite,
        recoveryPassphrase: importPassphrase,
        user
      });
      setImportAccountPassword("");
      setImportPassphrase("");
      setConfirmOverwrite(false);
      setImportText("");
      identityRestored();
      setIdentityStatus("checking");
      setIdentityRefreshToken((current) => current + 1);
      setImportSuccess(
        "Encryption identity restored on this device. Existing workspace key shares can now be unlocked normally."
      );
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Recovery kit import failed.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="recovery-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Account / Security</p>
          <h1>Encryption recovery</h1>
          <p>Back up or restore the private identity used to open workspace key shares.</p>
        </div>
      </header>

      <section className="panel recovery-status" aria-labelledby="recovery-status-title">
        <div>
          <p className="eyebrow">This browser / device</p>
          <h2 id="recovery-status-title">Local crypto identity</h2>
        </div>
        <span className={`identity-status identity-status--${identityStatus}`} role="status">
          {identityStatusLabel(identityStatus)}
        </span>
      </section>

      <EncryptionIdentitySetup
        onStatusChange={setIdentityStatus}
        refreshToken={identityRefreshToken}
      />

      <div className="warning-callout recovery-warning" role="note">
        <strong>Keep the recovery kit and its passphrase separate.</strong> Losing both the local
        private identity and a usable recovery kit can make encrypted shared workspaces inaccessible.
        The server cannot recover plaintext notes, comments, private keys, or workspace keys.
        CipherSpace has not been independently security audited.
      </div>

      <div className="recovery-grid">
        <section className="panel" aria-labelledby="recovery-export-title">
          <p className="eyebrow">Backup</p>
          <h2 id="recovery-export-title">Export encrypted recovery kit</h2>
          {identityStatus === "ready" ? (
            <>
              <p>
                The export contains public identity metadata and an AES-GCM-encrypted PKCS8 private
                key. It does not include workspace keys, notes, comments, auth tokens, or passwords.
              </p>
              <form className="form-stack" onSubmit={(event) => void createKit(event)}>
                <label>
                  Current account password
                  <input
                    autoComplete="current-password"
                    disabled={isExporting}
                    maxLength={128}
                    minLength={12}
                    onChange={(event) => setAccountPassword(event.target.value)}
                    required
                    type="password"
                    value={accountPassword}
                  />
                  <small>Used only in this browser to unlock the current local identity.</small>
                </label>
                <label>
                  Recovery passphrase
                  <input
                    autoComplete="new-password"
                    disabled={isExporting}
                    maxLength={128}
                    minLength={16}
                    onChange={(event) => setRecoveryPassphrase(event.target.value)}
                    required
                    type="password"
                    value={recoveryPassphrase}
                  />
                  <small>Use a unique 16–128 character passphrase, preferably from a password manager.</small>
                </label>
                <label>
                  Confirm recovery passphrase
                  <input
                    autoComplete="new-password"
                    disabled={isExporting}
                    maxLength={128}
                    minLength={16}
                    onChange={(event) => setRecoveryConfirmation(event.target.value)}
                    required
                    type="password"
                    value={recoveryConfirmation}
                  />
                </label>
                {exportError ? <div className="form-error" role="alert">{exportError}</div> : null}
                {exportSuccess ? <div className="form-success" role="status">{exportSuccess}</div> : null}
                <button className="button button--primary" disabled={isExporting}>
                  {isExporting ? "Encrypting…" : "Create recovery kit"}
                </button>
              </form>
              {kitText ? (
                <div className="recovery-output">
                  <label>
                    Encrypted recovery kit JSON
                    <textarea readOnly rows={8} value={kitText} />
                  </label>
                  <div className="recovery-actions">
                    <button className="button button--primary" onClick={downloadKit} type="button">
                      Download JSON
                    </button>
                    <button className="button button--secondary" onClick={() => void copyKit()} type="button">
                      Copy text
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="warning-callout">
              {identityStatus === "missing-unregistered"
                ? "This account has no registered public key yet. Set up this device above before exporting a recovery kit."
                : identityStatus === "local-unregistered"
                  ? "Complete public-key registration above before exporting a recovery kit."
                  : "There is no verified matching private identity in this browser to export. Import the account's recovery kit first."}
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="recovery-import-title">
          <p className="eyebrow">Restore</p>
          <h2 id="recovery-import-title">Import on this device</h2>
          <p>
            Sign in to the matching account, then paste the kit or select its JSON file. Decryption
            and private-key storage stay in this browser.
          </p>
          <form className="form-stack" onSubmit={(event) => void importKit(event)}>
            <label>
              Recovery kit file
              <input accept="application/json,.json,text/plain" onChange={(event) => void readKitFile(event)} type="file" />
            </label>
            <label>
              Recovery kit text
              <textarea
                maxLength={64 * 1024}
                onChange={(event) => setImportText(event.target.value)}
                placeholder="Paste the encrypted recovery kit JSON"
                required
                rows={8}
                value={importText}
              />
            </label>
            <label>
              Recovery passphrase
              <input
                autoComplete="off"
                maxLength={128}
                minLength={16}
                onChange={(event) => setImportPassphrase(event.target.value)}
                required
                type="password"
                value={importPassphrase}
              />
            </label>
            <label>
              Current account password
              <input
                autoComplete="current-password"
                maxLength={128}
                minLength={12}
                onChange={(event) => setImportAccountPassword(event.target.value)}
                required
                type="password"
                value={importAccountPassword}
              />
              <small>Re-encrypts the restored private key for local use on this device.</small>
            </label>
            {hasLocalIdentity ? (
              <label className="confirmation-check">
                <input
                  checked={confirmOverwrite}
                  onChange={(event) => setConfirmOverwrite(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  I understand this will replace the existing local identity only after the kit is
                  decrypted and its public key is verified against my account.
                </span>
              </label>
            ) : null}
            {importError ? <div className="form-error" role="alert">{importError}</div> : null}
            {importSuccess ? <div className="form-success" role="status">{importSuccess}</div> : null}
            <button
              className="button button--primary"
              disabled={isImporting || (hasLocalIdentity && !confirmOverwrite)}
            >
              {isImporting ? "Restoring…" : "Import recovery kit"}
            </button>
          </form>
        </section>
      </div>

      {identityStatus === "missing-registered" || identityStatus === "identity-mismatch" ? (
        <section className="panel replacement-identity" aria-labelledby="replacement-title">
          <p className="eyebrow">Without a recovery kit</p>
          <h2 id="replacement-title">Create a replacement identity and re-share access</h2>
          <p>
            A different identity cannot decrypt shares made for the lost key. Every workspace would
            need a member who still has access to wrap its key for the replacement identity. Server
            identity replacement and key re-sharing are intentionally not implemented in this v1
            recovery slice because they require a versioned key migration. Creating a new key here
            would not recover existing access.
          </p>
          <button className="button button--secondary" disabled type="button">
            Replacement identity unavailable in v1
          </button>
        </section>
      ) : null}
    </section>
  );
}
