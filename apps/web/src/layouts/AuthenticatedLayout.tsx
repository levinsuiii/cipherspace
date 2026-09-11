import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { WorkspaceKeyProvider } from "../key-management/WorkspaceKeyContext";
import { LocalDataProvider } from "../local-storage/LocalDataContext";

export function AuthenticatedLayout() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "Abmelden fehlgeschlagen.");
      setIsLoggingOut(false);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <LocalDataProvider userId={user.id}>
      <WorkspaceKeyProvider userId={user.id}>
        <div className="app-shell">
          <header className="topbar">
            <Link className="brand" to="/workspaces">
              <span className="brand-mark" aria-hidden="true">C</span>
              <span>CipherSpace</span>
            </Link>
            <nav aria-label="Hauptnavigation">
              <NavLink to="/workspaces">Workspaces</NavLink>
              <NavLink to="/account/security/recovery">Sicherheit</NavLink>
            </nav>
            <div className="account-menu">
              <span title={user.email}>{user.email}</span>
              <Link className="button button--quiet account-security-link" to="/account/security/recovery">
                Sicherheit
              </Link>
              <button
                className="button button--quiet"
                disabled={isLoggingOut}
                onClick={() => void handleLogout()}
                type="button"
              >
                {isLoggingOut ? "Wird abgemeldet…" : "Abmelden"}
              </button>
            </div>
          </header>
          {logoutError ? <div className="global-error" role="alert">{logoutError}</div> : null}
          {!user.emailVerifiedAt ? (
            <div className="global-error" role="status">
              Deine E-Mail-Adresse ist noch nicht bestätigt.{" "}
              <Link to="/verify-email">E-Mail bestätigen</Link>
            </div>
          ) : null}
          <main className="page-container">
            <Outlet />
          </main>
        </div>
      </WorkspaceKeyProvider>
    </LocalDataProvider>
  );
}
