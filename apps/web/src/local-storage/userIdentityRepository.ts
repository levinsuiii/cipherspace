import type { LocalUserCryptoIdentity } from "@cipherspace/crypto";

import type { CipherSpaceLocalDatabase } from "./database";
import type { LocalStoredUserCryptoIdentity } from "./types";

export class LocalIdentityAlreadyExistsError extends Error {
  public constructor() {
    super("A local encryption identity already exists on this device. Confirm replacement before importing.");
    this.name = "LocalIdentityAlreadyExistsError";
  }
}

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

  public async restore(
    identity: LocalUserCryptoIdentity,
    identityCreatedAt: string,
    overwrite = false
  ): Promise<LocalStoredUserCryptoIdentity> {
    return this.database.transaction("rw", this.database.user_crypto_identities, async () => {
      const existing = await this.get();
      if (existing && !overwrite) throw new LocalIdentityAlreadyExistsError();
      const stored: LocalStoredUserCryptoIdentity = {
        ...identity,
        created_at: identityCreatedAt,
        key: this.userId,
        updated_at: this.now(),
        user_id: this.userId
      };
      await this.database.user_crypto_identities.put(stored);
      return stored;
    });
  }
}
