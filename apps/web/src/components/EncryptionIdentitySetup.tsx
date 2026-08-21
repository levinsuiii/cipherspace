import { type FormEvent, useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { readLocalUserCryptoIdentity } from "../key-management/userIdentity";

export function EncryptionIdentitySetup() {
  const auth = useAuth();
  const { user } = auth;
  const [status, setStatus] = useState<"checking" | "missing" | "ready">("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user) return;
    void readLocalUserCryptoIdentity(user.id).then((identity) => {
      if (active) setStatus(identity && !auth.identityError ? "ready" : "missing");
    });
    return () => { active = false; };
  }, [auth.identityError, user]);

  if (!user || status === "checking" || status === "ready") return null;

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
        <p className="eyebrow">Required migration</p>
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
