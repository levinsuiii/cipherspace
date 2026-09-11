import {
  workspaceKeyShareCanonicalBytes,
  type SignedWorkspaceKeyShare
} from "@cipherspace/crypto";

import type { CipherSpaceLocalDatabase } from "./database";

function receiptKey(userId: string, workspaceId: string, operationId: string): string {
  return `${userId}:${workspaceId}:${operationId}`;
}

export class LocalAcceptedKeyShareRepository {
  public constructor(
    private readonly database: CipherSpaceLocalDatabase,
    private readonly userId: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  public async record(workspaceId: string, share: SignedWorkspaceKeyShare): Promise<void> {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", workspaceKeyShareCanonicalBytes(share)));
    const statementHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const key = receiptKey(this.userId, workspaceId, share.operationId);
    const existing = await this.database.accepted_key_shares.get(key);
    if (existing && existing.statement_hash !== statementHash) {
      throw new Error("Eine Schlüsselfreigabe-ID wurde mit anderem Inhalt wiederverwendet.");
    }
    if (!existing) {
      await this.database.accepted_key_shares.add({
        accepted_at: this.now(), key, operation_id: share.operationId, share,
        statement_hash: statementHash, user_id: this.userId, workspace_id: workspaceId
      });
    }
  }
}
