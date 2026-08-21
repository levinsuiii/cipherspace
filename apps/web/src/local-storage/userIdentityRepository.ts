import type { LocalUserCryptoIdentity } from "@cipherspace/crypto";

import type { CipherSpaceLocalDatabase } from "./database";
import type { LocalStoredUserCryptoIdentity } from "./types";

export class LocalUserIdentityRepository {
  public constructor(
    private readonly database: CipherSpaceLocalDatabase,
    private readonly userId: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  public get(): Promise<LocalStoredUserCryptoIdentity | undefined> {
    return this.database.user_crypto_identities.get(this.userId);
  }

  public async add(identity: LocalUserCryptoIdentity): Promise<LocalStoredUserCryptoIdentity> {
    const timestamp = this.now();
    const stored: LocalStoredUserCryptoIdentity = {
      ...identity,
      created_at: timestamp,
      key: this.userId,
      updated_at: timestamp,
      user_id: this.userId
    };
    await this.database.user_crypto_identities.add(stored);
    return stored;
  }
}
