import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import {
  inspectUserCryptoIdentity,
  type UserCryptoIdentityStatus
} from "../key-management/userIdentity";

interface EncryptionIdentitySetupProps {
  onStatusChange?: (status: UserCryptoIdentityStatus) => void;
  refreshToken?: number;
}

export function EncryptionIdentitySetup({
  onStatusChange,
  refreshToken = 0
}: EncryptionIdentitySetupProps) {
  const auth = useAuth();
  const { user } = auth;
  const [status, setStatus] = useState<UserCryptoIdentityStatus>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recoveryRecommended, setRecoveryRecommended] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!user) return;
    setStatus("checking");
    setError(null);
    try {
      setStatus(await inspectUserCryptoIdentity(user.id));
    } catch (caught) {
      setStatus("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Der Status der Verschlüsselungsidentität konnte nicht geprüft werden."
      );
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    if (!user) return;
    void (async () => {
      try {
        const inspected = await inspectUserCryptoIdentity(user.id);
        if (active) setStatus(inspected);
      } catch (caught) {
        if (!active) return;
        setStatus("error");
        setError(
          caught instanceof Error
            ? caught.message
            : "Der Status der Verschlüsselungsidentität konnte nicht geprüft werden."
        );
      }
    })();
    return () => { active = false; };
  }, [auth.identityError, refreshToken, user]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  if (!user || status === "checking") return null;

  if (status === "ready") {
    if (!recoveryRecommended) return null;
    return (
      <section className="panel identity-setup" aria-labelledby="identity-ready-title">
        <div>
          <p className="eyebrow">Gerät eingerichtet</p>
          <h2 id="identity-ready-title">Verschlüsselungsidentität erstellt</h2>
          <p>
            Der öffentliche Schlüssel ist registriert. Der geschützte private Schlüssel bleibt in
            diesem Browser. Mit einem verschlüsselten Wiederherstellungspaket lässt sich dieselbe
            Identität später auf einem anderen Gerät einrichten.
          </p>
        </div>
        <div className="identity-recovery-actions">
          <Link className="button button--primary" to="/account/security/recovery">
            Wiederherstellungspaket exportieren
          </Link>
        </div>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="panel identity-setup" aria-labelledby="identity-error-title">
        <div>
          <p className="eyebrow">Status nicht verfügbar</p>
          <h2 id="identity-error-title">Identität konnte nicht geprüft werden</h2>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
        </div>
        <button
          className="button button--secondary"
          onClick={() => void refreshStatus()}
          type="button"
        >
          Erneut prüfen
        </button>
      </section>
    );
  }

  if (status === "missing-registered" || status === "identity-mismatch") {
    return (
      <section className="panel identity-setup" aria-labelledby="identity-recovery-title">
        <div>
          <p className="eyebrow">Neues Gerät / fehlende Browserdaten</p>
          <h2 id="identity-recovery-title">
            {status === "identity-mismatch"
              ? "Dieses Gerät verwendet eine andere Identität"
              : "Deine private Verschlüsselungsidentität fehlt"}
          </h2>
          <p>
            Für diesen Account ist eine öffentliche Identität registriert, aber dem Browser fehlt
            der passende private Schlüssel. Importiere zuerst dein Wiederherstellungspaket.
          </p>
          <div className="warning-callout">
            Eine neue, unabhängige Identität kann vorhandene Freigaben nicht entschlüsseln. Eine
            Schlüsselumstellung wird in dieser Version nicht unterstützt.
          </div>
        </div>
        <div className="identity-recovery-actions">
          <Link className="button button--primary" to="/account/security/recovery">
            Wiederherstellungspaket importieren
          </Link>
          <button className="button button--secondary" disabled type="button">
            Ersatzidentität erstellen (nicht verfügbar)
          </button>
        </div>
      </section>
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await auth.ensureIdentity(password);
      const inspected = await inspectUserCryptoIdentity(user.id);
      if (inspected !== "ready") {
        throw new Error(
          "Lokale und registrierte Verschlüsselungsidentität stimmen nach der Einrichtung nicht überein."
        );
      }
      setPassword("");
      setStatus("ready");
      setRecoveryRecommended(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Die Verschlüsselungsidentität konnte nicht eingerichtet werden.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="panel identity-setup" aria-labelledby="identity-setup-title">
      <div>
        <p className="eyebrow">Einrichtung erforderlich</p>
        <h2 id="identity-setup-title">
          {status === "local-unregistered"
            ? "Verschlüsselungsidentität fertig einrichten"
            : "Dieses Gerät für Verschlüsselung einrichten"}
        </h2>
        <p>
          {status === "local-unregistered"
            ? "Eine geschützte private Identität ist bereits vorhanden. Bestätige sie mit deinem Account-Passwort, damit nur der öffentliche Schlüssel registriert wird."
            : "CipherSpace erzeugt im Browser ein RSA-Schlüsselpaar. Nur der öffentliche Schlüssel wird registriert; der private Schlüssel bleibt hier verschlüsselt gespeichert."}
        </p>
      </div>
      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Account-Passwort
          <input
            autoComplete="current-password"
            disabled={isSubmitting}
            maxLength={128}
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <small>Dieses Formular verwendet das Passwort lokal und sendet es nicht an die API.</small>
        </label>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <button className="button button--primary" disabled={isSubmitting}>
          {isSubmitting ? "Identität wird erstellt…" : "Verschlüsselungsidentität erstellen"}
        </button>
      </form>
    </section>
  );
}
