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
          : "Encryption identity status could not be checked."
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
            : "Encryption identity status could not be checked."
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
          <p className="eyebrow">Device ready</p>
          <h2 id="identity-ready-title">Encryption identity created</h2>
          <p>
            The public key is registered and the protected private key remains only in this
            browser. Export an encrypted recovery kit now so another device can restore this same
            identity if browser data is lost.
          </p>
        </div>
        <div className="identity-recovery-actions">
          <Link className="button button--primary" to="/account/security/recovery">
            Export recovery kit
          </Link>
        </div>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="panel identity-setup" aria-labelledby="identity-error-title">
        <div>
          <p className="eyebrow">Status unavailable</p>
          <h2 id="identity-error-title">Encryption identity could not be checked</h2>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
        </div>
        <button
          className="button button--secondary"
          onClick={() => void refreshStatus()}
          type="button"
        >
          Check again
        </button>
      </section>
    );
  }

  if (status === "missing-registered" || status === "identity-mismatch") {
    return (
      <section className="panel identity-setup" aria-labelledby="identity-recovery-title">
        <div>
          <p className="eyebrow">New device / missing browser data</p>
          <h2 id="identity-recovery-title">
            {status === "identity-mismatch"
              ? "This device has a different encryption identity"
              : "Your private encryption identity is missing"}
          </h2>
          <p>
            This account has a registered public identity, but this browser does not have the
            matching private key. Import your encrypted recovery kit before opening shared
            workspace key shares.
          </p>
          <div className="warning-callout">
            Do not create an unrelated identity: it cannot decrypt existing shares. A replacement
            would require members to re-share every workspace, and that key migration is not
            supported in v1.
          </div>
        </div>
        <div className="identity-recovery-actions">
          <Link className="button button--primary" to="/account/security/recovery">
            Import recovery kit
          </Link>
          <button className="button button--secondary" disabled type="button">
            Create replacement identity (unavailable in v1)
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
          "Encryption identity setup did not produce a matching local and registered identity."
        );
      }
      setPassword("");
      setStatus("ready");
      setRecoveryRecommended(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Encryption identity setup failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="panel identity-setup" aria-labelledby="identity-setup-title">
      <div>
        <p className="eyebrow">Required setup</p>
        <h2 id="identity-setup-title">
          {status === "local-unregistered"
            ? "Complete encryption identity setup"
            : "Set up this device for encryption"}
        </h2>
        <p>
          {status === "local-unregistered"
            ? "A protected private identity already exists in this browser. Verify it with your account password to register only its public key."
            : "CipherSpace will create a client-side RSA key pair. Only the public key is registered; the private key is encrypted in this browser with your account password."}
        </p>
      </div>
      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Account password
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
          <small>This setup form uses the password locally and does not submit it to the API.</small>
        </label>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <button className="button button--primary" disabled={isSubmitting}>
          {isSubmitting ? "Creating identity…" : "Create encryption identity"}
        </button>
      </form>
    </section>
  );
}
