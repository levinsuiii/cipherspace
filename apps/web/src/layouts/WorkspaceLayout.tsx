import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useParams } from "react-router-dom";

import { api } from "../api/client";
import type { Workspace } from "../api/types";
import { ErrorState, LoadingState } from "../components/AsyncState";
import { queryKeys } from "../queryKeys";

export interface WorkspaceOutletContext {
  workspace: Workspace;
}

export function WorkspaceLayout() {
  const { workspaceId = "" } = useParams();
  const workspaceQuery = useQuery({
    enabled: Boolean(workspaceId),
    queryKey: queryKeys.workspace(workspaceId),
    queryFn: () => api.workspaces.get(workspaceId)
  });

  if (workspaceQuery.isLoading) {
    return <LoadingState label="Loading workspace…" />;
  }
  if (workspaceQuery.isError) {
    return <ErrorState error={workspaceQuery.error} onRetry={() => void workspaceQuery.refetch()} />;
  }
  if (!workspaceQuery.data) {
    return <ErrorState error={new Error("Workspace not found.")} />;
  }

  const { workspace } = workspaceQuery.data;

  return (
    <section>
      <div className="breadcrumb"><NavLink to="/workspaces">Workspaces</NavLink><span>/</span></div>
      <header className="workspace-header">
        <div>
          <p className="eyebrow">{workspace.role} access</p>
          <h1>{workspace.name}</h1>
        </div>
        <span className={`role-badge role-badge--${workspace.role}`}>{workspace.role}</span>
      </header>
      <nav className="tabs" aria-label="Workspace navigation">
        <NavLink end to={`/workspaces/${workspace.id}`}>Overview</NavLink>
        <NavLink to={`/workspaces/${workspace.id}/notes`}>Notes</NavLink>
      </nav>
      <Outlet context={{ workspace } satisfies WorkspaceOutletContext} />
    </section>
  );
}
