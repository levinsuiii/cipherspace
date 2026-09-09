import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

interface AuthPageProps {
  mode: "login" | "register";
}

export function AuthPage({ mode }: AuthPageProps) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isLogin = mode === "login";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const credentials = { email, password };
      if (isLogin) {
        await auth.login(credentials);
      } else {
        await auth.register(credentials);
      }
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from?.startsWith("/") ? from : "/workspaces", { replace: true });
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "Anmeldung fehlgeschlagen."
      );
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
          <p className="eyebrow">Verschlüsselte Zusammenarbeit</p>
          <h1>Notizen teilen, ohne ihren Inhalt offenzulegen.</h1>
          <p>
            Notizen werden zuerst lokal gespeichert. Mit dem Workspace-Schlüssel verschlüsselt
            CipherSpace ausstehende Änderungen, bevor sie synchronisiert werden.
          </p>
        </div>
      </section>
      <section className="auth-panel" aria-labelledby="auth-title">
        <div>
          <p className="eyebrow">{isLogin ? "Weiterarbeiten" : "Neuer Zugang"}</p>
          <h2 id="auth-title">{isLogin ? "Anmelden" : "Account erstellen"}</h2>
        </div>
        <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            E-Mail-Adresse
            <input
              autoComplete="email"
              maxLength={254}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Passwort
            <input
              autoComplete={isLogin ? "current-password" : "new-password"}
              maxLength={128}
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            <small>12–128 Zeichen</small>
          </label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button className="button button--primary button--full" disabled={isSubmitting}>
            {isSubmitting ? "Einen Moment…" : isLogin ? "Anmelden" : "Account erstellen"}
          </button>
        </form>
        <p className="auth-switch">
          {isLogin ? "Noch kein Account?" : "Schon registriert?"}{" "}
          <Link to={isLogin ? "/register" : "/login"}>
            {isLogin ? "Account erstellen" : "Anmelden"}
          </Link>
        </p>
      </section>
    </main>
  );
}
