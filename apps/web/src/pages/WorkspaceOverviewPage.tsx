import {
  createPersonalVerificationCode,
  createSignedWorkspaceKeyShare,
  safetyNumberForVerificationCode,
  unlockUserSigningIdentity,
  verifyIdentityBundle,
  type PublicIdentityBundle
} from "@cipherspace/crypto";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";

import { api } from "../api/client";
import type { WorkspaceMember, WorkspaceRole } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { useWorkspaceKey } from "../key-management/WorkspaceKeyContext";
import { readLocalUserCryptoIdentity } from "../key-management/userIdentity";
import type { WorkspaceOutletContext } from "../layouts/WorkspaceLayout";
import { localDatabase } from "../local-storage/database";
import { LocalIdentityPinRepository } from "../local-storage/identityPinRepository";
import { queryKeys } from "../queryKeys";
import { formatDate, workspaceRoleLabel } from "../utils";

export function WorkspaceOverviewPage() {
  const { workspace } = useOutletContext<WorkspaceOutletContext>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const workspaceKey = useWorkspaceKey(workspace.id);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<WorkspaceRole, "owner">>("editor");
  const [identityPassword, setIdentityPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<{
    bundle: PublicIdentityBundle;
    email: string;
    safetyNumber: string;
  } | null>(null);
  const membersQuery = useQuery({
    queryKey: queryKeys.members(workspace.id),
    queryFn: () => api.workspaces.listMembers(workspace.id)
  });

  const prepareShare = async (
    requestedEmail: string,
    shareRole: WorkspaceRole,
    expectedUserId?: string
  ) => {
    if (!user) throw new Error("Melde dich an, bevor du Zugriff teilst.");
    const normalizedRequestedEmail = requestedEmail.trim().toLowerCase();
    const pinRepository = new LocalIdentityPinRepository(localDatabase, user.id);
    // Select the independently verified recipient from local state before the
    // backend gets any opportunity to identify an account for this request.
    const expectedPin = await pinRepository.getByVerifiedContact(normalizedRequestedEmail);
    if (expectedPin && expectedUserId && expectedPin.subject_user_id !== expectedUserId) {
      throw new Error("Das ausgewählte Mitglied gehört nicht zum lokal verifizierten Kontakt.");
    }
    const reference = expectedUserId
      ? { userId: expectedUserId }
      : { email: normalizedRequestedEmail };
    const { invitee } = await api.workspaces.getInviteeKey(workspace.id, reference);
    await verifyIdentityBundle(invitee.identityBundle);
    const expectedCode = createPersonalVerificationCode(invitee.identityBundle);
    setCandidate({
      bundle: invitee.identityBundle,
      email: normalizedRequestedEmail,
      safetyNumber: await safetyNumberForVerificationCode(expectedCode)
    });
    const verifiedRecipient = await pinRepository.requireVerifiedContact(
      normalizedRequestedEmail,
      invitee.userId,
      invitee.identityBundle,
      expectedUserId
    );
    const localIdentity = await readLocalUserCryptoIdentity(user.id);
    if (!localIdentity?.identityBundle || !localIdentity.signingIdentity) {
      throw new Error("Richte zuerst deine signierte Verschlüsselungsidentität ein.");
    }
    const signingKey = await unlockUserSigningIdentity(
      localIdentity.signingIdentity,
      identityPassword,
      { userId: user.id }
    );
    // CS-001: do not touch the workspace key until the exact candidate passed
    // independent local-pin verification above.
    const key = await workspaceKey.getKey();
    return {
      invitee,
      keyShare: await createSignedWorkspaceKeyShare({
        recipient: verifiedRecipient,
        role: shareRole,
        senderBundle: localIdentity.identityBundle,
        senderSigningPrivateKey: signingKey,
        workspaceId: workspace.id,
        workspaceKey: key
      })
    };
  };

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      const prepared = await prepareShare(email, role);
      return api.workspaces.addMember(workspace.id, {
        keyShare: prepared.keyShare,
        role,
        userId: prepared.invitee.userId
      });
    },
    onSuccess: async () => {
      setEmail("");
      setIdentityPassword("");
      setCandidate(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.members(workspace.id) });
    }
  });
  const repairShareMutation = useMutation({
    mutationFn: async (member: WorkspaceMember) => {
      const prepared = await prepareShare(member.email, member.role, member.userId);
      return api.workspaces.putKeyShare(workspace.id, member.userId, prepared.keyShare);
    },
    onSuccess: async () => {
      setIdentityPassword("");
      setCandidate(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.members(workspace.id) });
    }
  });

  const verifyCandidate = async () => {
    if (!user || !candidate) return;
    setVerificationError(null);
    try {
      await new LocalIdentityPinRepository(localDatabase, user.id).verifyFromIndependentCode(
        candidate.bundle,
        createPersonalVerificationCode(candidate.bundle),
        verificationCode.trim(),
        candidate.email
      );
      setVerificationCode("");
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : "Die Identität konnte nicht verifiziert werden.");
    }
  };

  const handleInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (email.trim()) addMemberMutation.mutate();
  };

  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="section-heading">
          <div><p className="eyebrow">Workspace-Zugriff</p><h2>Mitglieder</h2></div>
          <span className="count-badge">{membersQuery.data?.members.length ?? "—"}</span>
        </div>
        {membersQuery.isLoading ? <LoadingState label="Mitglieder werden geladen…" /> : null}
        {membersQuery.isError ? <ErrorState error={membersQuery.error} onRetry={() => void membersQuery.refetch()} /> : null}
        {membersQuery.data?.members.length === 0 ? <EmptyState description="Für diesen Workspace sind keine Mitglieder sichtbar." title="Keine Mitglieder" /> : null}
        {membersQuery.data?.members.length ? (
          <ul className="member-list">
            {membersQuery.data.members.map((member) => (
              <li key={member.userId}>
                <span className="avatar" aria-hidden="true">{member.email.slice(0, 1).toUpperCase()}</span>
                <div><strong>{member.email}</strong><small>Seit {formatDate(member.addedAt)} · Schlüsselfreigabe {member.keyShareStatus === "available" ? "vorhanden" : "fehlt"}</small></div>
                {workspace.role === "owner" && member.keyShareStatus === "missing" ? (
                  <button className="button button--quiet" disabled={repairShareMutation.isPending || workspaceKey.status !== "unlocked" || !identityPassword} onClick={() => repairShareMutation.mutate(member)} type="button">Schlüssel teilen</button>
                ) : null}
                <span className={`role-badge role-badge--${member.role}`}>{workspaceRoleLabel(member.role)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {workspace.role === "owner" ? (
          <form className="form-stack member-invite-form" onSubmit={handleInvite}>
            <div><p className="eyebrow">Mitglied hinzufügen</p><h3>Verifizierten Zugriff teilen</h3><p>Der Workspace-Schlüssel wird erst nach unabhängiger Identitätsprüfung verschlüsselt.</p></div>
            <label>E-Mail eines registrierten Accounts<input autoComplete="email" disabled={addMemberMutation.isPending} maxLength={254} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
            <label>Rolle<select disabled={addMemberMutation.isPending} onChange={(event) => setRole(event.target.value as "editor" | "viewer")} value={role}><option value="editor">Editor</option><option value="viewer">Leser</option></select></label>
            <label>Account-Passwort für die digitale Signatur<input autoComplete="current-password" disabled={addMemberMutation.isPending} maxLength={128} minLength={12} onChange={(event) => setIdentityPassword(event.target.value)} required type="password" value={identityPassword} /></label>
            {candidate ? (
              <div className="identity-verification" role="status">
                <strong>Identität von {candidate.email} unabhängig bestätigen</strong>
                <p>Vergleiche diese vollständige Sicherheitsnummer direkt mit der Person:</p>
                <code>{candidate.safetyNumber}</code>
                <label>Oder füge ihren direkt erhaltenen Code ein<textarea onChange={(event) => setVerificationCode(event.target.value)} placeholder="cipherspace-verify:…" rows={3} value={verificationCode} /></label>
                {verificationError ? <div className="form-error" role="alert">{verificationError}</div> : null}
                <button className="button button--secondary" onClick={() => void verifyCandidate()} type="button">Identität verifizieren</button>
              </div>
            ) : null}
            {workspaceKey.status !== "unlocked" ? <div className="warning-callout">Entsperre den Workspace, bevor du ein Mitglied hinzufügst.</div> : null}
            {addMemberMutation.error ? <div className="form-error" role="alert">{addMemberMutation.error.message}</div> : null}
            {repairShareMutation.error ? <div className="form-error" role="alert">{repairShareMutation.error.message}</div> : null}
            <button className="button button--primary" disabled={addMemberMutation.isPending || workspaceKey.status !== "unlocked" || !email.trim() || !identityPassword}>{addMemberMutation.isPending ? "Zugriff wird geprüft…" : "Mitglied hinzufügen"}</button>
          </form>
        ) : null}
      </section>
      <aside className="panel workspace-summary">
        <p className="eyebrow">Workspace-Datensatz</p>
        <dl><div><dt>Erstellt</dt><dd>{formatDate(workspace.createdAt)}</dd></div><div><dt>Aktualisiert</dt><dd>{formatDate(workspace.updatedAt)}</dd></div><div><dt>Deine Rolle</dt><dd>{workspaceRoleLabel(workspace.role)}</dd></div><div><dt>Workspace ID</dt><dd className="mono">{workspace.id}</dd></div></dl>
        <Link className="button button--secondary button--full" to="notes">Notizen öffnen</Link>
      </aside>
    </div>
  );
}
