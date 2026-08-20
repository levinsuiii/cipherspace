import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";

import { ApiError, api } from "../api/client";
import type { Workspace } from "../api/types";
import { ErrorState, LoadingState } from "../components/AsyncState";
import { WorkspaceSyncControls } from "../components/WorkspaceSyncControls";
import { useWorkspaceKey } from "../key-management/WorkspaceKeyContext";
import { useLocalData, useLocalQuery } from "../local-storage/LocalDataContext";
import { queryKeys } from "../queryKeys";
import { NoteSyncEngine } from "../sync/engine";

export interface WorkspaceOutletContext {
  workspace: Workspace;
}

export function WorkspaceLayout() {
  const { workspaceId = "" } = useParams();
  const localData = useLocalData();
  const workspaceKey = useWorkspaceKey(workspaceId);
  const syncEngine = useMemo(
    () => new NoteSyncEngine(localData, api.sync, { getWorkspaceKey: workspaceKey.getKey }),
    [localData, workspaceKey.getKey]
  );
  const cachedWorkspaceQuery = useLocalQuery(
    () => localData.getWorkspace(workspaceId),
    [localData, workspaceId]
  );
  const pendingChangesQuery = useLocalQuery(
    () => localData.countPendingChanges(workspaceId),
    [localData, workspaceId]
  );
  const conflictsQuery = useLocalQuery(
    () => localData.countConflicts(workspaceId),
    [localData, workspaceId]
  );
  const workspaceQuery = useQuery({
    enabled: Boolean(workspaceId),
    queryKey: queryKeys.workspace(workspaceId),
    queryFn: async () => {
      const result = await api.workspaces.get(workspaceId);
      await localData.cacheWorkspace(result.workspace);
      return result;
    },
    retry: false
  });

  const cachedWorkspace = cachedWorkspaceQuery.data;
  const workspace: Workspace | undefined = workspaceQuery.data?.workspace ??
    (cachedWorkspace
      ? {
          createdAt: cachedWorkspace.created_at,
          id: cachedWorkspace.id,
          name: cachedWorkspace.name,
          role: cachedWorkspace.role,
          updatedAt: cachedWorkspace.updated_at
        }
      : undefined);
  const workspaceError = workspaceQuery.error;
  const serverUnavailable = workspaceError instanceof TypeError;

  if (!workspace && (workspaceQuery.isLoading || cachedWorkspaceQuery.isLoading)) {
    return <LoadingState label="Loading workspace…" />;
  }
  if (!workspace && workspaceQuery.isError) {
    return <ErrorState error={workspaceQuery.error} onRetry={() => void workspaceQuery.refetch()} />;
  }
  if (!workspace) {
    return <ErrorState error={new Error("Workspace not found.")} />;
  }

  return (
    <section>
      {serverUnavailable ? (
        <div className="offline-callout" role="status">
          The server is unavailable. Showing the local workspace cache; note edits still save on
          this device.
        </div>
      ) : null}
      {workspaceQuery.isError && !serverUnavailable ? (
        <div className="form-error" role="alert">
          {workspaceError instanceof ApiError
            ? workspaceError.message
            : "The workspace could not be refreshed from the server."}
        </div>
      ) : null}
      <div className="breadcrumb"><NavLink to="/workspaces">Workspaces</NavLink><span>/</span></div>
      <header className="workspace-header">
        <div>
          <p className="eyebrow">{workspace.role} access</p>
          <h1>{workspace.name}</h1>
        </div>
        <div className="status-badges">
          {(conflictsQuery.data ?? 0) > 0 ? (
            <span className="conflict-badge">{conflictsQuery.data} conflicts</span>
          ) : null}
          {(pendingChangesQuery.data ?? 0) > 0 ? (
            <span className="unsynced-badge">
              {pendingChangesQuery.data} unsynced
            </span>
          ) : null}
          <span className={`role-badge role-badge--${workspace.role}`}>{workspace.role}</span>
        </div>
      </header>
      <WorkspaceSyncControls
        conflictCount={conflictsQuery.data ?? 0}
        keyStatus={workspaceKey.status}
        onCreateKey={workspaceKey.create}
        onLock={workspaceKey.lock}
        onSync={() => syncEngine.syncWorkspace(workspace.id)}
        onUnlock={workspaceKey.unlock}
        pendingCount={pendingChangesQuery.data ?? 0}
      />
      <nav className="tabs" aria-label="Workspace navigation">
        <NavLink end to={`/workspaces/${workspace.id}`}>Overview</NavLink>
        <NavLink to={`/workspaces/${workspace.id}/notes`}>Notes</NavLink>
      </nav>
      <Outlet context={{ workspace } satisfies WorkspaceOutletContext} />
    </section>
  );
}
