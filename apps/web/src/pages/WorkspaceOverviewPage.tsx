import { useQuery } from "@tanstack/react-query";
import { Link, useOutletContext } from "react-router-dom";

import { api } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import type { WorkspaceOutletContext } from "../layouts/WorkspaceLayout";
import { queryKeys } from "../queryKeys";
import { formatDate } from "../utils";

export function WorkspaceOverviewPage() {
  const { workspace } = useOutletContext<WorkspaceOutletContext>();
  const membersQuery = useQuery({
    queryKey: queryKeys.members(workspace.id),
    queryFn: () => api.workspaces.listMembers(workspace.id)
  });

  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Directory</p>
            <h2>Members</h2>
          </div>
          <span className="count-badge">{membersQuery.data?.members.length ?? "—"}</span>
        </div>
        {membersQuery.isLoading ? <LoadingState label="Loading members…" /> : null}
        {membersQuery.isError ? (
          <ErrorState error={membersQuery.error} onRetry={() => void membersQuery.refetch()} />
        ) : null}
        {membersQuery.data?.members.length === 0 ? (
          <EmptyState description="This workspace has no visible members." title="No members" />
        ) : null}
        {membersQuery.data?.members.length ? (
          <ul className="member-list">
            {membersQuery.data.members.map((member) => (
              <li key={member.userId}>
                <span className="avatar" aria-hidden="true">
                  {member.email.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{member.email}</strong>
                  <small>Joined {formatDate(member.addedAt)}</small>
                </div>
                <span className={`role-badge role-badge--${member.role}`}>{member.role}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <aside className="panel workspace-summary">
        <p className="eyebrow">Workspace record</p>
        <dl>
          <div><dt>Created</dt><dd>{formatDate(workspace.createdAt)}</dd></div>
          <div><dt>Last updated</dt><dd>{formatDate(workspace.updatedAt)}</dd></div>
          <div><dt>Your role</dt><dd>{workspace.role}</dd></div>
          <div><dt>Workspace ID</dt><dd className="mono">{workspace.id}</dd></div>
        </dl>
        <Link className="button button--secondary button--full" to="notes">
          Open notes
        </Link>
      </aside>
    </div>
  );
}
