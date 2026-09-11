import {
  createPersonalVerificationCode,
  safetyNumberForVerificationCode
} from "@cipherspace/crypto";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { EncryptionIdentitySetup } from "../components/EncryptionIdentitySetup";
import {
  exportLocalUserRecoveryKit,
  importLocalUserRecoveryKit,
  parseRecoveryKitText
} from "../key-management/recovery";
import type { UserCryptoIdentityStatus } from "../key-management/userIdentity";
import { readLocalUserCryptoIdentity } from "../key-management/userIdentity";

function identityStatusLabel(status: UserCryptoIdentityStatus): string {
  switch (status) {
    case "ready":
      return "Lokal vorhanden und registriert";
    case "missing-unregistered":
      return "Ersteinrichtung erforderlich";
    case "local-unregistered":
      return "Registrierung unvollständig";
    case "missing-registered":
      return "Wiederherstellung erforderlich";
    case "identity-mismatch":
      return "Lokale Identität passt nicht zum Account";
    case "error":
      return "Status nicht verfügbar";
    default:
      return "Wird geprüft…";
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
  const [verification, setVerification] = useState<{ code: string; safetyNumber: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVerification(null);
    if (!user) return () => { cancelled = true; };
    void readLocalUserCryptoIdentity(user.id).then(async (identity) => {
      if (!identity?.identityBundle) return;
      const code = createPersonalVerificationCode(identity.identityBundle);
      const safetyNumber = await safetyNumberForVerificationCode(code);
      if (!cancelled) setVerification({ code, safetyNumber });
    }).catch(() => {
      if (!cancelled) setVerification(null);
    });
    return () => { cancelled = true; };
  }, [identityRefreshToken, identityStatus, user]);

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
      setExportError("Die Wiederherstellungspassphrasen stimmen nicht überein.");
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
      setExportSuccess("Verschlüsseltes Wiederherstellungspaket lokal erstellt. Bewahre es geschützt auf.");
    } catch (error) {
      setKitText("");
      setExportError(error instanceof Error ? error.message : "Export des Wiederherstellungspakets fehlgeschlagen.");
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
      setExportSuccess("Verschlüsseltes Wiederherstellungspaket kopiert.");
    } catch {
      setExportError("Zugriff auf die Zwischenablage fehlgeschlagen. Kopiere den Text manuell.");
    }
  };

  const readKitFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      setImportText(await file.text());
    } catch {
      setImportError("Die ausgewählte Datei konnte nicht gelesen werden.");
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
        "Verschlüsselungsidentität auf diesem Gerät wiederhergestellt. Vorhandene Workspace-Freigaben lassen sich wieder entsperren."
      );
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import des Wiederherstellungspakets fehlgeschlagen.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="recovery-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Account / Sicherheit</p>
          <h1>Wiederherstellung</h1>
          <p>Sichere oder importiere die private Identität für Workspace-Schlüsselfreigaben.</p>
        </div>
      </header>

      <section className="panel recovery-status" aria-labelledby="recovery-status-title">
        <div>
          <p className="eyebrow">Dieser Browser / dieses Gerät</p>
          <h2 id="recovery-status-title">Lokale Verschlüsselungsidentität</h2>
        </div>
        <span className={`identity-status identity-status--${identityStatus}`} role="status">
          {identityStatusLabel(identityStatus)}
        </span>
      </section>

      <EncryptionIdentitySetup
        onStatusChange={setIdentityStatus}
        refreshToken={identityRefreshToken}
      />

      {verification ? (
        <section className="panel" aria-labelledby="identity-verification-title">
          <p className="eyebrow">Unabhängige Identitätsprüfung</p>
          <h2 id="identity-verification-title">Dein Verifizierungscode</h2>
          <p>
            Teile diesen Code oder die Sicherheitsnummer persönlich bzw. über einen bereits
            vertrauenswürdigen Kanal. Andere Mitglieder dürfen ihn nicht aus CipherSpace selbst übernehmen.
          </p>
          <label>
            Verifizierungscode
            <textarea readOnly rows={4} value={verification.code} />
          </label>
          <p><strong>Sicherheitsnummer:</strong> {verification.safetyNumber}</p>
        </section>
      ) : null}

      <div className="warning-callout recovery-warning" role="note">
        <strong>Bewahre Paket und Passphrase getrennt auf.</strong> Ohne lokale private Identität
        und nutzbares Wiederherstellungspaket können verschlüsselte Workspaces unzugänglich werden.
        Der Server kann Notizinhalte, Kommentare, private Schlüssel oder Workspace-Schlüssel nicht
        wiederherstellen. CipherSpace wurde nicht unabhängig sicherheitsgeprüft.
      </div>

      <div className="recovery-grid">
        <section className="panel" aria-labelledby="recovery-export-title">
          <p className="eyebrow">Sicherung</p>
          <h2 id="recovery-export-title">Wiederherstellungspaket exportieren</h2>
          {identityStatus === "ready" ? (
            <>
              <p>
                Der Export enthält öffentliche Identitätsmetadaten und einen mit AES-GCM
                verschlüsselten privaten PKCS8-Schlüssel. Workspace-Schlüssel, Notizen, Kommentare,
                Sitzungstoken und Passwörter sind nicht enthalten.
              </p>
              <form className="form-stack" onSubmit={(event) => void createKit(event)}>
                <label>
                  Aktuelles Account-Passwort
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
                  <small>Wird nur in diesem Browser zum Entsperren der lokalen Identität verwendet.</small>
                </label>
                <label>
                  Wiederherstellungspassphrase
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
                  <small>Verwende 16–128 eindeutige Zeichen, am besten aus einem Passwortmanager.</small>
                </label>
                <label>
                  Wiederherstellungspassphrase bestätigen
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
                  {isExporting ? "Wird verschlüsselt…" : "Wiederherstellungspaket erstellen"}
                </button>
              </form>
              {kitText ? (
                <div className="recovery-output">
                  <label>
                    Verschlüsseltes Wiederherstellungspaket (JSON)
                    <textarea readOnly rows={8} value={kitText} />
                  </label>
                  <div className="recovery-actions">
                    <button className="button button--primary" onClick={downloadKit} type="button">
                      JSON herunterladen
                    </button>
                    <button className="button button--secondary" onClick={() => void copyKit()} type="button">
                      Text kopieren
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="warning-callout">
              {identityStatus === "missing-unregistered"
                ? "Für diesen Account ist noch kein öffentlicher Schlüssel registriert. Richte das Gerät zuerst oben ein."
                : identityStatus === "local-unregistered"
                  ? "Schließe oben die Registrierung des öffentlichen Schlüssels ab."
                  : "In diesem Browser ist keine passende private Identität zum Exportieren vorhanden. Importiere zuerst das Paket des Accounts."}
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="recovery-import-title">
          <p className="eyebrow">Wiederherstellen</p>
          <h2 id="recovery-import-title">Auf diesem Gerät importieren</h2>
          <p>
            Melde dich beim passenden Account an und füge das Paket als Text oder JSON-Datei ein.
            Entschlüsselung und Speicherung des privaten Schlüssels bleiben in diesem Browser.
          </p>
          <form className="form-stack" onSubmit={(event) => void importKit(event)}>
            <label>
              Datei des Wiederherstellungspakets
              <input accept="application/json,.json,text/plain" onChange={(event) => void readKitFile(event)} type="file" />
            </label>
            <label>
              Inhalt des Wiederherstellungspakets
              <textarea
                maxLength={64 * 1024}
                onChange={(event) => setImportText(event.target.value)}
                placeholder="Verschlüsseltes JSON hier einfügen"
                required
                rows={8}
                value={importText}
              />
            </label>
            <label>
              Wiederherstellungspassphrase
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
              Aktuelles Account-Passwort
              <input
                autoComplete="current-password"
                maxLength={128}
                minLength={12}
                onChange={(event) => setImportAccountPassword(event.target.value)}
                required
                type="password"
                value={importAccountPassword}
              />
              <small>Verschlüsselt den wiederhergestellten privaten Schlüssel für dieses Gerät neu.</small>
            </label>
            {hasLocalIdentity ? (
              <label className="confirmation-check">
                <input
                  checked={confirmOverwrite}
                  onChange={(event) => setConfirmOverwrite(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  Ich verstehe, dass die vorhandene lokale Identität erst ersetzt wird, nachdem das
                  Paket entschlüsselt und sein öffentlicher Schlüssel mit meinem Account geprüft wurde.
                </span>
              </label>
            ) : null}
            {importError ? <div className="form-error" role="alert">{importError}</div> : null}
            {importSuccess ? <div className="form-success" role="status">{importSuccess}</div> : null}
            <button
              className="button button--primary"
              disabled={isImporting || (hasLocalIdentity && !confirmOverwrite)}
            >
              {isImporting ? "Wird wiederhergestellt…" : "Wiederherstellungspaket importieren"}
            </button>
          </form>
        </section>
      </div>

      {identityStatus === "missing-registered" || identityStatus === "identity-mismatch" ? (
        <section className="panel replacement-identity" aria-labelledby="replacement-title">
          <p className="eyebrow">Ohne Wiederherstellungspaket</p>
          <h2 id="replacement-title">Ersatzidentität und neue Freigaben</h2>
          <p>
            Eine andere Identität kann Freigaben für den verlorenen Schlüssel nicht entschlüsseln.
            Jeder Workspace bräuchte ein Mitglied mit Zugriff, das seinen Schlüssel erneut teilt.
            Diese versionierte Schlüsselumstellung ist derzeit nicht implementiert. Ein neuer
            Schlüssel würde vorhandenen Zugriff nicht wiederherstellen.
          </p>
          <button className="button button--secondary" disabled type="button">
            Ersatzidentität derzeit nicht verfügbar
          </button>
        </section>
      ) : null}
    </section>
  );
}
