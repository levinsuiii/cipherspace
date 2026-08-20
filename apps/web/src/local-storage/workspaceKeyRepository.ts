import type { ProtectedWorkspaceKey } from "@cipherspace/crypto";

import type { CipherSpaceLocalDatabase } from "./database";
import type { LocalProtectedWorkspaceKey } from "./types";

interface WorkspaceKeyRepositoryOptions {
  now?: () => string;
}

function scopedKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}

export class LocalWorkspaceKeyRepository {
  private readonly now: () => string;

  public constructor(
    private readonly database: CipherSpaceLocalDatabase,
    private readonly userId: string,
    options: WorkspaceKeyRepositoryOptions = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async get(workspaceId: string): Promise<LocalProtectedWorkspaceKey | undefined> {
    return this.database.workspace_keys.get(scopedKey(this.userId, workspaceId));
  }

  public async add(workspaceId: string, protectedKey: ProtectedWorkspaceKey): Promise<void> {
    const timestamp = this.now();
    await this.database.workspace_keys.add({
      created_at: timestamp,
      key: scopedKey(this.userId, workspaceId),
      protected_key: protectedKey,
      updated_at: timestamp,
      user_id: this.userId,
      workspace_id: workspaceId
    });
  }
}
