import type {
  SyncPullResponse,
  SyncPushChange,
  SyncPushResponse
} from "../api/types";
import type { LocalNotesRepository } from "../local-storage/repository";
import type { PendingChange } from "../local-storage/types";
import { encryptPendingNoteChange } from "./crypto";
import { parseSyncPullResponse, parseSyncPushResponse } from "./protocol";

export interface SyncTransport {
  pull(workspaceId: string, cursor: string | null): Promise<unknown>;
  push(workspaceId: string, clientId: string, changes: SyncPushChange[]): Promise<unknown>;
}

export interface SyncEngineOptions {
  getWorkspaceKey(workspaceId: string): Promise<CryptoKey>;
}

export interface SyncSummary {
  conflicts: number;
  pulled: number;
  pushed: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Sync failed.";
}

function wireChange(change: PendingChange): SyncPushChange {
  return {
    baseVersionId: change.base_version_id,
    clientRevision: change.local_revision,
    createdAtClient: change.created_at,
    encryptedPayload: change.encrypted_payload,
    noteId: change.note_id,
    operationId: change.id,
    operationType: change.operation_type
  };
}

export class NoteSyncEngine {
  private readonly activeSyncs = new Map<string, Promise<SyncSummary>>();

  public constructor(
    private readonly localData: LocalNotesRepository,
    private readonly transport: SyncTransport,
    private readonly options: SyncEngineOptions
  ) {}

  public syncWorkspace(workspaceId: string): Promise<SyncSummary> {
    const active = this.activeSyncs.get(workspaceId);
    if (active) return active;
    const sync = this.runSync(workspaceId).finally(() => {
      this.activeSyncs.delete(workspaceId);
    });
    this.activeSyncs.set(workspaceId, sync);
    return sync;
  }

  private async runSync(workspaceId: string): Promise<SyncSummary> {
    const workspaceKey = await this.options.getWorkspaceKey(workspaceId);
    await this.localData.migratePlaintextWorkspace(workspaceId, workspaceKey);
    const metadata = await this.localData.getSyncMetadata(workspaceId);
    const retryable = await this.localData.listRetryableChanges(workspaceId);

    for (const change of retryable) {
      if (change.operation_type === "delete_note" || change.encrypted_payload) continue;
      try {
        const encrypted = await encryptPendingNoteChange(change, workspaceKey);
        await this.localData.storeEncryptedPayload(change.id, change.local_revision, encrypted);
      } catch (error) {
        const started = await this.localData.beginSyncAttempt([change]);
        await this.localData.markSyncAttemptFailed(started, errorMessage(error));
      }
    }

    const prepared = (await this.localData.listRetryableChanges(workspaceId)).filter(
      (change) => change.operation_type === "delete_note" || change.encrypted_payload !== null
    );
    const preparedIds = prepared.map((change) => change.id);
    const attempted: PendingChange[] = [];
    const pushResponses: SyncPushResponse[] = [];

    try {
      for (const changeId of preparedIds) {
        const current = (await this.localData.listRetryableChanges(workspaceId)).find(
          (change) => change.id === changeId
        );
        if (!current) continue;
        const started = await this.localData.beginSyncAttempt([current]);
        const change = started[0];
        if (!change) continue;
        attempted.push(change);
        const pushResponse = parseSyncPushResponse(
          await this.transport.push(workspaceId, metadata.client_id, [wireChange(change)])
        );
        if (pushResponse.workspaceId !== workspaceId) {
          throw new Error("The sync push response belongs to a different workspace.");
        }
        pushResponses.push(pushResponse);
        await this.localData.applyPushResults(workspaceId, [change], pushResponse.results);
      }

      let cursor = (await this.localData.getSyncMetadata(workspaceId)).last_pull_cursor;
      let pulled = 0;
      let response: SyncPullResponse;
      do {
        response = parseSyncPullResponse(await this.transport.pull(workspaceId, cursor));
        if (response.workspaceId !== workspaceId) {
          throw new Error("The sync pull response belongs to a different workspace.");
        }
        await this.localData.applyPullResponse(response);
        pulled += response.changes.length;
        cursor = response.nextCursor;
      } while (response.hasMore);

      return {
        conflicts: await this.localData.countConflicts(workspaceId),
        pulled,
        pushed: pushResponses.flatMap((response) => response.results).filter(
            (result) =>
              result.status === "accepted" ||
              (result.status === "duplicate" && result.originalStatus === "accepted")
          ).length
      };
    } catch (error) {
      const message = errorMessage(error);
      await this.localData.markSyncAttemptFailed(attempted, message);
      await this.localData.recordSyncFailure(workspaceId, message);
      throw error;
    }
  }
}
