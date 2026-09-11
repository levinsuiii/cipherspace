import { useQuery } from "@tanstack/react-query";
import {
  createSignedWorkspaceKeyShare,
  createPersonalVerificationCode,
  unlockUserCryptoIdentity,
  unlockUserSigningIdentity,
  unwrapVerifiedWorkspaceKeyShare,
  verifyIdentityBundle,
  verifyOwnIdentityBundle
} from "@cipherspace/crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";

import { ApiError, api } from "../api/client";
import type { Workspace } from "../api/types";
import { ErrorState, LoadingState } from "../components/AsyncState";
import { LegacyPlaintextGate } from "../components/LegacyPlaintextGate";
import { WorkspaceSyncControls } from "../components/WorkspaceSyncControls";
import { useWorkspaceKey } from "../key-management/WorkspaceKeyContext";
import { useLocalData, useLocalQuery } from "../local-storage/LocalDataContext";
import { queryKeys } from "../queryKeys";
import { NoteSyncEngine } from "../sync/engine";
import { useAuth } from "../auth/AuthContext";
import { readLocalUserCryptoIdentity } from "../key-management/userIdentity";
import { workspaceRoleLabel } from "../utils";
import { localDatabase } from "../local-storage/database";
import { LocalIdentityPinRepository } from "../local-storage/identityPinRepository";

export interface WorkspaceOutletContext {
  workspace: Workspace;
}

export function WorkspaceLayout() {
  const { workspaceId = "" } = useParams();
  const { user } = useAuth();
  const localData = useLocalData();
  const workspaceKey = useWorkspaceKey(workspaceId);
  const [localEncryptionError, setLocalEncryptionError] = useState<string | null>(null);
  const [isMigratingLegacy, setIsMigratingLegacy] = useState(false);
  const [migrationRetry, setMigrationRetry] = useState(0);
  const activeMigration = useRef<{
    promise: Promise<number>;
    workspaceId: string;
  } | null>(null);
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
  const legacyPlaintextQuery = useLocalQuery(
    () => localData.inspectLegacyPlaintextWorkspace(workspaceId),
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
  const keyAccessQuery = useQuery({
    enabled: Boolean(workspaceId),
    queryKey: ["workspaces", workspaceId, "key-access"],
    queryFn: () => api.workspaces.getKeyAccess(workspaceId),
    retry: false
  });

  useEffect(() => {
    let active = true;
    if (
      !workspaceId ||
      workspaceKey.status !== "unlocked" ||
      !legacyPlaintextQuery.data?.totalRecords
    ) {
      setIsMigratingLegacy(false);
      if (!legacyPlaintextQuery.data?.totalRecords) setLocalEncryptionError(null);
      return () => { active = false; };
    }
    setLocalEncryptionError(null);
    setIsMigratingLegacy(true);
    let migration = activeMigration.current;
    if (!migration || migration.workspaceId !== workspaceId) {
      const promise = workspaceKey.getKey()
        .then((key) => localData.migratePlaintextWorkspace(workspaceId, key));
      migration = { promise, workspaceId };
      activeMigration.current = migration;
      void promise.finally(() => {
        if (activeMigration.current?.promise === promise) activeMigration.current = null;
      }).catch(() => undefined);
    }
    void migration.promise
      .catch((caught: unknown) => {
        if (active) {
          setLocalEncryptionError(
            caught instanceof Error
              ? caught.message
              : "Lokale Bestandsdaten konnten nicht in den verschlüsselten Speicher übertragen werden."
          );
        }
      })
      .finally(() => {
        if (active) setIsMigratingLegacy(false);
      });
    return () => { active = false; };
  }, [
    legacyPlaintextQuery.data?.totalRecords,
    localData,
    migrationRetry,
    workspaceId,
    workspaceKey.getKey,
    workspaceKey.status
  ]);

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

  const requireLocalIdentity = async () => {
    if (!user) throw new Error("Melde dich an, bevor du verschlüsselten Workspace-Zugriff teilst.");
    const identity = await readLocalUserCryptoIdentity(user.id);
    if (!identity) {
      throw new Error("Richte zuerst auf der Workspace-Seite deine Verschlüsselungsidentität ein.");
    }
    return identity;
  };

  const createInitialWorkspaceKey = async (identityPassword: string, passphrase: string) => {
    const identity = await requireLocalIdentity();
    if (!identity.identityBundle || !identity.signingIdentity) {
      throw new Error("Aktualisiere zuerst deine signierte Verschlüsselungsidentität.");
    }
    const selfBundle = await verifyOwnIdentityBundle(identity.identityBundle, {
      encryptionPublicKey: identity.publicKey,
      signingPublicKey: identity.signingIdentity.publicKey,
      userId: user!.id
    });
    const signingKey = await unlockUserSigningIdentity(
      identity.signingIdentity,
      identityPassword,
      { userId: user!.id }
    );
    await workspaceKey.create(passphrase);
    const key = await workspaceKey.getKey();
    const share = await createSignedWorkspaceKeyShare({
      recipient: selfBundle,
      role: "owner",
      senderBundle: identity.identityBundle,
      senderSigningPrivateKey: signingKey,
      workspaceId,
      workspaceKey: key
    });
    await api.workspaces.putKeyShare(workspaceId, user!.id, share);
    await keyAccessQuery.refetch();
  };

  const setupSharedWorkspace = async (
    identityPassword: string,
    passphrase: string,
    senderVerificationCode: string
  ) => {
    const identity = await requireLocalIdentity();
    if (!identity.identityBundle || !identity.signingIdentity) throw new Error("Die lokale signierte Identität fehlt.");
    const recipientBundle = await verifyOwnIdentityBundle(identity.identityBundle, {
      encryptionPublicKey: identity.publicKey,
      signingPublicKey: identity.signingIdentity.publicKey,
      userId: user!.id
    });
    const [privateKey, result] = await Promise.all([
      unlockUserCryptoIdentity(identity, identityPassword, { userId: user!.id }),
      api.workspaces.getOwnKeyShare(workspaceId)
    ]);
    const share = result.keyShare.signedShare;
    const workspaceRole = workspace?.role;
    if (!workspaceRole || share.role !== workspaceRole) {
      throw new Error("Die signierte Rolle stimmt nicht mit der Workspace-Mitgliedschaft überein.");
    }
    let senderSigningIdentity;
    if (share.sender.userId === user!.id) {
      senderSigningIdentity = recipientBundle.signingKey;
    } else {
      const senderBundle = result.keyShare.senderIdentityBundle;
      await verifyIdentityBundle(senderBundle);
      if (
        senderBundle.userId !== share.sender.userId ||
        senderBundle.bundleSequence !== share.sender.bundleSequence ||
        senderBundle.signingKey.fingerprint !== share.sender.signingKeyFingerprint
      ) {
        throw new Error("Die Server-Identität des Absenders passt nicht zur signierten Freigabe.");
      }
      const pinRepository = new LocalIdentityPinRepository(localDatabase, user!.id);
      const existingPin = await pinRepository.get(senderBundle.userId);
      if (!existingPin) {
        if (!senderVerificationCode) {
          throw new Error("Gib zuerst den unabhängig erhaltenen Verifizierungscode des Workspace-Besitzers ein.");
        }
        await pinRepository.verifyFromIndependentCode(
          senderBundle,
          createPersonalVerificationCode(senderBundle),
          senderVerificationCode
        );
      }
      senderSigningIdentity = (await pinRepository.requireVerified(senderBundle)).signingKey;
    }
    const workspaceCryptoKey = await unwrapVerifiedWorkspaceKeyShare({
      recipientBundle,
      recipientPrivateKey: privateKey,
      senderSigningIdentity,
      share,
      workspaceId
    });
    await workspaceKey.storeShared(workspaceCryptoKey, passphrase, share);
  };

  if (!workspace && (workspaceQuery.isLoading || cachedWorkspaceQuery.isLoading)) {
    return <LoadingState label="Workspace wird geladen…" />;
  }
  if (!workspace && workspaceQuery.isError) {
    return <ErrorState error={workspaceQuery.error} onRetry={() => void workspaceQuery.refetch()} />;
  }
  if (!workspace) {
    return <ErrorState error={new Error("Workspace nicht gefunden.")} />;
  }
  if (legacyPlaintextQuery.isLoading) {
    return <LoadingState label="Lokaler Speicher wird auf ältere Klartextdaten geprüft…" />;
  }
  if (legacyPlaintextQuery.error) {
    return <ErrorState error={legacyPlaintextQuery.error} />;
  }

  const legacyInspection = legacyPlaintextQuery.data!;
  const normalWorkspace = (
    <>
      <WorkspaceSyncControls
        conflictCount={conflictsQuery.data ?? 0}
        keyStatus={workspaceKey.status}
        keyAccess={keyAccessQuery.data?.keyAccess ?? null}
        onCreateKey={createInitialWorkspaceKey}
        onLock={workspaceKey.lock}
        onSync={() => syncEngine.syncWorkspace(workspace.id)}
        onSetupShared={setupSharedWorkspace}
        onUnlock={workspaceKey.unlock}
        pendingCount={pendingChangesQuery.data ?? 0}
      />
      <nav className="tabs" aria-label="Workspace-Navigation">
        <NavLink end to={`/workspaces/${workspace.id}`}>Übersicht</NavLink>
        <NavLink to={`/workspaces/${workspace.id}/notes`}>Notizen</NavLink>
      </nav>
      <Outlet context={{ workspace } satisfies WorkspaceOutletContext} />
    </>
  );

  return (
    <section>
      {serverUnavailable ? (
        <div className="offline-callout" role="status">
          Der Server ist nicht erreichbar. Der lokale Workspace bleibt verfügbar; Änderungen
          werden weiterhin auf diesem Gerät gespeichert.
        </div>
      ) : null}
      {workspaceQuery.isError && !serverUnavailable ? (
        <div className="form-error" role="alert">
          {workspaceError instanceof ApiError
            ? workspaceError.message
            : "Der Workspace konnte nicht vom Server aktualisiert werden."}
        </div>
      ) : null}
      <div className="breadcrumb"><NavLink to="/workspaces">Workspaces</NavLink><span>/</span></div>
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Zugriff: {workspaceRoleLabel(workspace.role)}</p>
          <h1>{workspace.name}</h1>
        </div>
        <div className="status-badges">
          {(conflictsQuery.data ?? 0) > 0 ? (
            <span className="conflict-badge">{conflictsQuery.data} Konflikte</span>
          ) : null}
          {(pendingChangesQuery.data ?? 0) > 0 ? (
            <span className="unsynced-badge">
              {pendingChangesQuery.data} ausstehend
            </span>
          ) : null}
          <span className={`role-badge role-badge--${workspace.role}`}>{workspaceRoleLabel(workspace.role)}</span>
        </div>
      </header>
      <LegacyPlaintextGate
        accessControls={(
          <WorkspaceSyncControls
            conflictCount={conflictsQuery.data ?? 0}
            keyStatus={workspaceKey.status}
            keyAccess={keyAccessQuery.data?.keyAccess ?? null}
            legacyMigrationRequired
            onCreateKey={createInitialWorkspaceKey}
            onLock={workspaceKey.lock}
            onSync={() => syncEngine.syncWorkspace(workspace.id)}
            onSetupShared={setupSharedWorkspace}
            onUnlock={workspaceKey.unlock}
            pendingCount={pendingChangesQuery.data ?? 0}
          />
        )}
        error={localEncryptionError}
        inspection={legacyInspection}
        isMigrating={isMigratingLegacy}
        onDelete={() => localData.deleteLegacyPlaintextWorkspace(workspaceId).then(() => undefined)}
        onRetry={() => setMigrationRetry((current) => current + 1)}
      >
        {normalWorkspace}
      </LegacyPlaintextGate>
    </section>
  );
}
