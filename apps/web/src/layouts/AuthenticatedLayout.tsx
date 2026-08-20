import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
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
      setLogoutError(error instanceof Error ? error.message : "Could not sign out.");
      setIsLoggingOut(false);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <LocalDataProvider userId={user.id}>
      <div className="app-shell">
        <header className="topbar">
          <Link className="brand" to="/workspaces">
            <span className="brand-mark" aria-hidden="true">C</span>
            <span>CipherSpace</span>
          </Link>
          <nav aria-label="Primary navigation">
            <NavLink to="/workspaces">Workspaces</NavLink>
          </nav>
          <div className="account-menu">
            <span title={user.email}>{user.email}</span>
            <button
              className="button button--quiet"
              disabled={isLoggingOut}
              onClick={() => void handleLogout()}
              type="button"
            >
              {isLoggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </header>
        {logoutError ? <div className="global-error" role="alert">{logoutError}</div> : null}
        <main className="page-container">
          <Outlet />
        </main>
      </div>
    </LocalDataProvider>
  );
}
