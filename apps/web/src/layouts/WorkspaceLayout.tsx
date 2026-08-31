import { useQuery } from "@tanstack/react-query";
import {
  unlockUserCryptoIdentity,
  unwrapWorkspaceKeyShare,
  wrapWorkspaceKeyForRecipient
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
              : "Existing local data could not be migrated to encrypted storage."
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
    if (!user) throw new Error("Sign in before using encrypted workspace sharing.");
    const identity = await readLocalUserCryptoIdentity(user.id);
    if (!identity) {
      throw new Error("Set up your encryption identity from the workspaces page first.");
    }
    return identity;
  };

  const createInitialWorkspaceKey = async (passphrase: string) => {
    const identity = await requireLocalIdentity();
    await workspaceKey.create(passphrase);
    const key = await workspaceKey.getKey();
    const share = await wrapWorkspaceKeyForRecipient(key, identity, {
      recipientKeyVersion: identity.keyVersion,
      recipientUserId: user!.id,
      workspaceId
    });
    await api.workspaces.putKeyShare(workspaceId, user!.id, {
      algorithm: share.algorithm,
      encryptedWorkspaceKey: share.ciphertext,
      recipientKeyVersion: share.recipientKeyVersion
    });
    await keyAccessQuery.refetch();
  };

  const setupSharedWorkspace = async (identityPassword: string, passphrase: string) => {
    const identity = await requireLocalIdentity();
    const [privateKey, result] = await Promise.all([
      unlockUserCryptoIdentity(identity, identityPassword, { userId: user!.id }),
      api.workspaces.getOwnKeyShare(workspaceId)
    ]);
    const share = result.keyShare;
    const workspaceCryptoKey = await unwrapWorkspaceKeyShare(
      {
        algorithm: share.algorithm,
        ciphertext: share.encryptedWorkspaceKey,
        recipientKeyVersion: share.recipientKeyVersion
      },
      privateKey,
      {
        recipientKeyVersion: share.recipientKeyVersion,
        recipientUserId: user!.id,
        workspaceId
      }
    );
    await workspaceKey.storeShared(workspaceCryptoKey, passphrase);
  };

  if (!workspace && (workspaceQuery.isLoading || cachedWorkspaceQuery.isLoading)) {
    return <LoadingState label="Loading workspace…" />;
  }
  if (!workspace && workspaceQuery.isError) {
    return <ErrorState error={workspaceQuery.error} onRetry={() => void workspaceQuery.refetch()} />;
  }
  if (!workspace) {
    return <ErrorState error={new Error("Workspace not found.")} />;
  }
  if (legacyPlaintextQuery.isLoading) {
    return <LoadingState label="Checking local storage for legacy plaintext…" />;
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
      <nav className="tabs" aria-label="Workspace navigation">
        <NavLink end to={`/workspaces/${workspace.id}`}>Overview</NavLink>
        <NavLink to={`/workspaces/${workspace.id}/notes`}>Notes</NavLink>
      </nav>
      <Outlet context={{ workspace } satisfies WorkspaceOutletContext} />
    </>
  );

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
