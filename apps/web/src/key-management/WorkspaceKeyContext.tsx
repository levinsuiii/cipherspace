import {
  generateWorkspaceKey,
  protectWorkspaceKey,
  unlockWorkspaceKey
} from "@cipherspace/crypto";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { localDatabase } from "../local-storage/database";
import { LocalWorkspaceKeyRepository } from "../local-storage/workspaceKeyRepository";

export type WorkspaceKeyStatus = "checking" | "locked" | "missing" | "unlocked";

export class WorkspaceLockedError extends Error {
  public constructor() {
    super("Unlock this workspace before syncing.");
    this.name = "WorkspaceLockedError";
  }
}

const backgroundLockMessage =
  "CipherSpace locked because the app moved to the background. Return to the app and unlock again.";

interface WorkspaceKeyContextValue {
  create(workspaceId: string, passphrase: string): Promise<void>;
  getKey(workspaceId: string): Promise<CryptoKey>;
  inspect(workspaceId: string): Promise<void>;
  lock(workspaceId: string): void;
  statusByWorkspace: ReadonlyMap<string, WorkspaceKeyStatus>;
  unlock(workspaceId: string, passphrase: string): Promise<void>;
}

const WorkspaceKeyContext = createContext<WorkspaceKeyContextValue | null>(null);

export function WorkspaceKeyProvider({
  children,
  userId
}: PropsWithChildren<{ userId: string }>) {
  const repository = useMemo(
    () => new LocalWorkspaceKeyRepository(localDatabase, userId),
    [userId]
  );
  const unlockedKeys = useRef(new Map<string, CryptoKey>());
  const lockGeneration = useRef(0);
  const [statusByWorkspace, setStatusByWorkspace] = useState<
    ReadonlyMap<string, WorkspaceKeyStatus>
  >(new Map());

  useEffect(() => {
    const keys = unlockedKeys.current;
    return () => keys.clear();
  }, [userId]);

  const setStatus = useCallback((workspaceId: string, status: WorkspaceKeyStatus) => {
    setStatusByWorkspace((current) => {
      const next = new Map(current);
      next.set(workspaceId, status);
      return next;
    });
  }, []);

  const lockAll = useCallback(() => {
    lockGeneration.current += 1;
    const workspaceIds = [...unlockedKeys.current.keys()];
    unlockedKeys.current.clear();
    if (workspaceIds.length === 0) return;

    setStatusByWorkspace((current) => {
      const next = new Map(current);
      for (const workspaceId of workspaceIds) next.set(workspaceId, "locked");
      return next;
    });
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") lockAll();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", lockAll);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", lockAll);
    };
  }, [lockAll]);

  const inspect = useCallback(
    async (workspaceId: string) => {
      if (unlockedKeys.current.has(workspaceId)) {
        setStatus(workspaceId, "unlocked");
        return;
      }
      setStatus(workspaceId, "checking");
      const stored = await repository.get(workspaceId);
      setStatus(workspaceId, stored ? "locked" : "missing");
    },
    [repository, setStatus]
  );

  const create = useCallback(
    async (workspaceId: string, passphrase: string) => {
      const startedAtGeneration = lockGeneration.current;
      if (await repository.get(workspaceId)) {
        throw new Error("A protected workspace key already exists. Unlock it instead.");
      }
      const workspaceKey = await generateWorkspaceKey();
      const protectedKey = await protectWorkspaceKey(workspaceKey, passphrase, {
        userId,
        workspaceId
      });
      await repository.add(workspaceId, protectedKey);
      if (
        lockGeneration.current !== startedAtGeneration ||
        document.visibilityState === "hidden"
      ) {
        setStatus(workspaceId, "locked");
        throw new Error(backgroundLockMessage);
      }
      unlockedKeys.current.set(workspaceId, workspaceKey);
      setStatus(workspaceId, "unlocked");
    },
    [repository, setStatus, userId]
  );

  const unlock = useCallback(
    async (workspaceId: string, passphrase: string) => {
      const startedAtGeneration = lockGeneration.current;
      const stored = await repository.get(workspaceId);
      if (!stored) throw new Error("No protected workspace key exists on this device.");
      const workspaceKey = await unlockWorkspaceKey(stored.protected_key, passphrase, {
        userId,
        workspaceId
      });
      if (
        lockGeneration.current !== startedAtGeneration ||
        document.visibilityState === "hidden"
      ) {
        setStatus(workspaceId, "locked");
        throw new Error(backgroundLockMessage);
      }
      unlockedKeys.current.set(workspaceId, workspaceKey);
      setStatus(workspaceId, "unlocked");
    },
    [repository, setStatus, userId]
  );

  const lock = useCallback(
    (workspaceId: string) => {
      lockGeneration.current += 1;
      unlockedKeys.current.delete(workspaceId);
      setStatus(workspaceId, "locked");
    },
    [setStatus]
  );

  const getKey = useCallback(async (workspaceId: string) => {
    const key = unlockedKeys.current.get(workspaceId);
    if (!key) throw new WorkspaceLockedError();
    return key;
  }, []);

  const value = useMemo<WorkspaceKeyContextValue>(
    () => ({ create, getKey, inspect, lock, statusByWorkspace, unlock }),
    [create, getKey, inspect, lock, statusByWorkspace, unlock]
  );
  return <WorkspaceKeyContext.Provider value={value}>{children}</WorkspaceKeyContext.Provider>;
}

export function useWorkspaceKey(workspaceId: string) {
  const context = useContext(WorkspaceKeyContext);
  if (!context) throw new Error("useWorkspaceKey must be used inside WorkspaceKeyProvider");

  useEffect(() => {
    if (workspaceId) void context.inspect(workspaceId);
  }, [context.inspect, workspaceId]);

  const create = useCallback(
    (passphrase: string) => context.create(workspaceId, passphrase),
    [context.create, workspaceId]
  );
  const getKey = useCallback(
    () => context.getKey(workspaceId),
    [context.getKey, workspaceId]
  );
  const lock = useCallback(() => context.lock(workspaceId), [context.lock, workspaceId]);
  const unlock = useCallback(
    (passphrase: string) => context.unlock(workspaceId, passphrase),
    [context.unlock, workspaceId]
  );

  return {
    create,
    getKey,
    lock,
    status: context.statusByWorkspace.get(workspaceId) ?? "checking",
    unlock
  };
}
