import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { USER_IDENTITY_KEY_VERSION, wrapWorkspaceKeyForRecipient } from "@cipherspace/crypto";
import { type FormEvent, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";

import { api } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import type { WorkspaceOutletContext } from "../layouts/WorkspaceLayout";
import { queryKeys } from "../queryKeys";
import { formatDate, workspaceRoleLabel } from "../utils";
import { useWorkspaceKey } from "../key-management/WorkspaceKeyContext";
import type { WorkspaceMember, WorkspaceRole } from "../api/types";

export function WorkspaceOverviewPage() {
  const { workspace } = useOutletContext<WorkspaceOutletContext>();
  const queryClient = useQueryClient();
  const workspaceKey = useWorkspaceKey(workspace.id);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<WorkspaceRole, "owner">>("editor");
  const membersQuery = useQuery({
    queryKey: queryKeys.members(workspace.id),
    queryFn: () => api.workspaces.listMembers(workspace.id)
  });
  const prepareShare = async (reference: { email: string } | { userId: string }) => {
    const [key, inviteeResult] = await Promise.all([
      workspaceKey.getKey(),
      api.workspaces.getInviteeKey(workspace.id, reference)
    ]);
    const invitee = inviteeResult.invitee;
    if (invitee.identity.keyVersion !== USER_IDENTITY_KEY_VERSION) {
      throw new Error("Diese Version der Empfängeridentität wird nicht unterstützt.");
    }
    const wrapped = await wrapWorkspaceKeyForRecipient(key, {
      ...invitee.identity,
      keyVersion: USER_IDENTITY_KEY_VERSION
    }, {
      recipientKeyVersion: invitee.identity.keyVersion,
      recipientUserId: invitee.userId,
      workspaceId: workspace.id
    });
    return {
      invitee,
      keyShare: {
        algorithm: wrapped.algorithm,
        encryptedWorkspaceKey: wrapped.ciphertext,
        recipientKeyVersion: wrapped.recipientKeyVersion
      }
    };
  };
  const addMemberMutation = useMutation({
    mutationFn: async () => {
      const prepared = await prepareShare({ email: email.trim().toLowerCase() });
      return api.workspaces.addMember(workspace.id, {
        email: prepared.invitee.email,
        keyShare: prepared.keyShare,
        role
      });
    },
    onSuccess: async () => {
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.members(workspace.id) });
    }
  });
  const repairShareMutation = useMutation({
    mutationFn: async (member: WorkspaceMember) => {
      const prepared = await prepareShare({ userId: member.userId });
      return api.workspaces.putKeyShare(workspace.id, member.userId, prepared.keyShare);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.members(workspace.id) });
    }
  });

  const handleInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (email.trim()) addMemberMutation.mutate();
  };

  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Workspace-Zugriff</p>
            <h2>Mitglieder</h2>
          </div>
          <span className="count-badge">{membersQuery.data?.members.length ?? "—"}</span>
        </div>
        {membersQuery.isLoading ? <LoadingState label="Mitglieder werden geladen…" /> : null}
        {membersQuery.isError ? (
          <ErrorState error={membersQuery.error} onRetry={() => void membersQuery.refetch()} />
        ) : null}
        {membersQuery.data?.members.length === 0 ? (
          <EmptyState description="Für diesen Workspace sind keine Mitglieder sichtbar." title="Keine Mitglieder" />
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
                  <small>
                    Seit {formatDate(member.addedAt)} · Schlüsselfreigabe {member.keyShareStatus === "available" ? "vorhanden" : "fehlt"}
                  </small>
                </div>
                {workspace.role === "owner" && member.keyShareStatus === "missing" ? (
                  <button
                    className="button button--quiet"
                    disabled={repairShareMutation.isPending || workspaceKey.status !== "unlocked"}
                    onClick={() => repairShareMutation.mutate(member)}
                    type="button"
                  >
                    Schlüssel teilen
                  </button>
                ) : null}
                <span className={`role-badge role-badge--${member.role}`}>{workspaceRoleLabel(member.role)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {workspace.role === "owner" ? (
          <form className="form-stack member-invite-form" onSubmit={handleInvite}>
            <div>
              <p className="eyebrow">Mitglied hinzufügen</p>
              <h3>Verschlüsselten Zugriff teilen</h3>
              <p>
                CipherSpace lädt den registrierten öffentlichen Schlüssel des Empfängers und
                überträgt nur einen dafür verschlüsselten Workspace-Schlüssel.
              </p>
            </div>
            <label>
              E-Mail eines registrierten Accounts
              <input
                autoComplete="email"
                disabled={addMemberMutation.isPending}
                maxLength={254}
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <label>
              Rolle
              <select
                disabled={addMemberMutation.isPending}
                onChange={(event) => setRole(event.target.value as "editor" | "viewer")}
                value={role}
              >
                <option value="editor">Editor</option>
                <option value="viewer">Leser</option>
              </select>
            </label>
            {workspaceKey.status !== "unlocked" ? (
              <div className="warning-callout">Entsperre den Workspace, bevor du ein Mitglied hinzufügst.</div>
            ) : null}
            {addMemberMutation.error ? (
              <div className="form-error" role="alert">{addMemberMutation.error.message}</div>
            ) : null}
            {repairShareMutation.error ? (
              <div className="form-error" role="alert">{repairShareMutation.error.message}</div>
            ) : null}
            <button
              className="button button--primary"
              disabled={
                addMemberMutation.isPending ||
                workspaceKey.status !== "unlocked" ||
                !email.trim()
              }
            >
              {addMemberMutation.isPending ? "Zugriff wird verschlüsselt…" : "Mitglied hinzufügen"}
            </button>
          </form>
        ) : null}
      </section>

      <aside className="panel workspace-summary">
        <p className="eyebrow">Workspace-Datensatz</p>
        <dl>
          <div><dt>Erstellt</dt><dd>{formatDate(workspace.createdAt)}</dd></div>
          <div><dt>Aktualisiert</dt><dd>{formatDate(workspace.updatedAt)}</dd></div>
          <div><dt>Deine Rolle</dt><dd>{workspaceRoleLabel(workspace.role)}</dd></div>
          <div><dt>Workspace ID</dt><dd className="mono">{workspace.id}</dd></div>
        </dl>
        <Link className="button button--secondary button--full" to="notes">
          Notizen öffnen
        </Link>
      </aside>
    </div>
  );
}
