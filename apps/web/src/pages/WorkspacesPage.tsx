import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { useLocalData, useLocalQuery } from "../local-storage/LocalDataContext";
import { queryKeys } from "../queryKeys";
import { formatDate } from "../utils";

export function WorkspacesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const localData = useLocalData();
  const [name, setName] = useState("");
  const cachedWorkspacesQuery = useLocalQuery(
    () => localData.listWorkspaces(),
    [localData]
  );
  const workspacesQuery = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: async () => {
      const result = await api.workspaces.list();
      await localData.cacheWorkspaces(result.workspaces);
      return result;
    },
    retry: false
  });
  const createMutation = useMutation({
    mutationFn: api.workspaces.create,
    onSuccess: async ({ workspace }) => {
      await localData.cacheWorkspace(workspace);
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      navigate(`/workspaces/${workspace.id}`);
    }
  });

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName) {
      createMutation.mutate(trimmedName);
    }
  };

  const workspaces = cachedWorkspacesQuery.data ?? [];

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Your collaboration spaces</p>
          <h1>Workspaces</h1>
          <p>Create a workspace or return to one you already belong to.</p>
        </div>
      </header>

      <div className="split-layout">
        <div>
          {cachedWorkspacesQuery.isLoading && workspacesQuery.isLoading ? (
            <LoadingState label="Loading workspaces…" />
          ) : null}
          {workspacesQuery.isError && workspaces.length === 0 ? (
            <ErrorState
              error={workspacesQuery.error}
              onRetry={() => void workspacesQuery.refetch()}
            />
          ) : null}
          {workspacesQuery.isError && workspaces.length > 0 ? (
            <div className="offline-callout" role="status">
              Showing cached workspaces while the server is unavailable.
            </div>
          ) : null}
          {workspaces.length === 0 && !workspacesQuery.isLoading && !workspacesQuery.isError ? (
            <EmptyState
              description="Create your first workspace using the form on this page."
              title="No workspaces yet"
            />
          ) : null}
          {workspaces.length ? (
            <div className="card-list">
              {workspaces.map((workspace) => (
                <Link className="workspace-card" key={workspace.id} to={`/workspaces/${workspace.id}`}>
                  <div className="workspace-card__mark" aria-hidden="true">
                    {workspace.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="workspace-card__content">
                    <div>
                      <h2>{workspace.name}</h2>
                      <span className={`role-badge role-badge--${workspace.role}`}>
                        {workspace.role}
                      </span>
                    </div>
                    <p>Updated {formatDate(workspace.updated_at)}</p>
                  </div>
                  <span className="card-arrow" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="panel panel--sticky">
          <p className="eyebrow">New workspace</p>
          <h2>Create a workspace</h2>
          <p>Workspace names are visible to the server and all members.</p>
          <form className="form-stack" onSubmit={handleCreate}>
            <label>
              Workspace name
              <input
                autoFocus
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                placeholder="Research lab"
                required
                value={name}
              />
            </label>
            {createMutation.error ? (
              <div className="form-error" role="alert">{createMutation.error.message}</div>
            ) : null}
            <button
              className="button button--primary"
              disabled={createMutation.isPending || !name.trim()}
            >
              {createMutation.isPending ? "Creating…" : "Create workspace"}
            </button>
          </form>
        </aside>
      </div>
    </section>
  );
}
