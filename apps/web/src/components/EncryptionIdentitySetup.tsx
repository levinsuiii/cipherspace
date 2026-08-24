import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { readLocalUserCryptoIdentity } from "../key-management/userIdentity";

export function EncryptionIdentitySetup() {
  const auth = useAuth();
  const { user } = auth;
  const [status, setStatus] = useState<
    "checking" | "missing-registered" | "missing-unregistered" | "ready"
  >("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user) return;
    void (async () => {
      const identity = await readLocalUserCryptoIdentity(user.id);
      if (identity && !auth.identityError) {
        if (active) setStatus("ready");
        return;
      }
      try {
        await api.cryptoIdentity.get();
        if (active) setStatus("missing-registered");
      } catch (error) {
        if (active) {
          setStatus(
            error instanceof ApiError && error.status === 404
              ? "missing-unregistered"
              : "missing-registered"
          );
        }
      }
    })();
    return () => { active = false; };
  }, [auth.identityError, user]);

  if (!user || status === "checking" || status === "ready") return null;

  if (status === "missing-registered") {
    return (
      <section className="panel identity-setup" aria-labelledby="identity-recovery-title">
        <div>
          <p className="eyebrow">New device / missing browser data</p>
          <h2 id="identity-recovery-title">Your private encryption identity is missing</h2>
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
      setPassword("");
      setStatus("ready");
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
        <h2 id="identity-setup-title">Set up your encryption identity</h2>
        <p>
          CipherSpace will create a client-side RSA key pair. Only the public key is registered;
          the private key is encrypted in this browser with your account password.
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
