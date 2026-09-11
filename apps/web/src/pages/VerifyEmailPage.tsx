import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

function readVerificationTokenFromFragment(): string {
  const fragment = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(fragment).get("token") ?? "";
}

export function VerifyEmailPage() {
  const { user } = useAuth();
  const [token, setToken] = useState(readVerificationTokenFromFragment);
  if (window.location.hash) {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`
    );
  }
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendComplete, setResendComplete] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);

  const resend = async () => {
    setResendError(null);
    setIsResending(true);
    try {
      await api.auth.requestEmailVerification();
      setResendComplete(true);
    } catch {
      setResendError(
        "Die Bestätigungs-E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut."
      );
      setIsResending(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.auth.confirmEmail(token, password);
      setComplete(true);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Bestätigung fehlgeschlagen.");
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-layout">
      <section className="auth-intro">
        <div className="brand brand--large">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>CipherSpace</span>
        </div>
        <div>
          <p className="eyebrow">Mailbox-Nachweis</p>
          <h1>Bestätige, dass diese Adresse dir gehört.</h1>
          <p>Der kurzlebige Code und dein gewähltes Account-Passwort werden gemeinsam geprüft.</p>
        </div>
      </section>
      <section className="auth-panel" aria-labelledby="verification-title">
        <h2 id="verification-title">E-Mail bestätigen</h2>
        {user && !user.emailVerifiedAt ? (
          <div className="form-stack">
            <p>Noch keine E-Mail erhalten?</p>
            {resendComplete ? (
              <p role="status">
                Falls die Adresse bestätigt werden kann, wurde eine neue E-Mail gesendet.
              </p>
            ) : (
              <button
                className="button button--quiet"
                disabled={isResending}
                onClick={() => void resend()}
                type="button"
              >
                {isResending ? "Wird gesendet…" : "Bestätigungs-E-Mail erneut senden"}
              </button>
            )}
            {resendError ? <div className="form-error" role="alert">{resendError}</div> : null}
          </div>
        ) : null}
        {complete ? (
          <div>
            <p>Die E-Mail-Adresse wurde bestätigt.</p>
            <Link className="button button--primary" to="/login">Anmelden</Link>
          </div>
        ) : (
          <form className="form-stack" onSubmit={(event) => void submit(event)}>
            <label>
              Bestätigungscode
              <input
                autoComplete="one-time-code"
                maxLength={43}
                minLength={43}
                onChange={(event) => setToken(event.target.value)}
                required
                value={token}
              />
            </label>
            <label>
              Account-Passwort
              <input
                autoComplete="current-password"
                maxLength={128}
                minLength={12}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="button button--primary button--full" disabled={isSubmitting}>
              {isSubmitting ? "Wird bestätigt…" : "E-Mail bestätigen"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
