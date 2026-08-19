import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { ErrorState, LoadingState } from "./AsyncState";

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isLoading) {
    return <LoadingState label="Checking your session…" />;
  }
  if (auth.error) {
    return <ErrorState error={auth.error} title="Could not reach CipherSpace" />;
  }
  if (!auth.user) {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }
  return <Outlet />;
}

export function PublicOnlyRoute() {
  const auth = useAuth();

  if (auth.isLoading) {
    return <LoadingState label="Checking your session…" />;
  }
  if (auth.user) {
    return <Navigate replace to="/workspaces" />;
  }
  return <Outlet />;
}
