import {
  AES_GCM_NONCE_LENGTH_BYTES,
  AES_GCM_TAG_LENGTH_BITS,
  AES_KEY_LENGTH_BITS,
  NOTE_ENCRYPTION_ALGORITHM,
  USER_SIGNING_ALGORITHM,
  USER_SIGNING_KEY_VERSION
} from "./constants.js";
import { decodeBase64, encodeBase64 } from "./encoding.js";
import { CipherSpaceCryptoError } from "./errors.js";
import type {
  LocalUserSigningIdentity,
  ProtectedSigningPrivateKey,
  PublicUserSigningIdentity,
  UserIdentityProtectionContext
} from "./types.js";

const SIGNING_ALGORITHM = "ECDSA" as const;
const SIGNING_CURVE = "P-256" as const;
const SIGNING_HASH = "SHA-256" as const;
const KDF_ALGORITHM = "PBKDF2" as const;
const KDF_HASH = "SHA-256" as const;
const KDF_ITERATIONS = 600_000 as const;
const PROTECTION_VERSION = 1 as const;
const SALT_LENGTH_BYTES = 16;
const MIN_PASSPHRASE_LENGTH = 12;
const MAX_PASSPHRASE_LENGTH = 128;
const MAX_PRIVATE_KEY_BYTES = 1_024;
const MAX_PUBLIC_KEY_BYTES = 256;
const textEncoder = new TextEncoder();

function assertContext(context: UserIdentityProtectionContext): void {
  if (!context || typeof context.userId !== "string" || context.userId.length < 1 || context.userId.length > 200) {
    throw new TypeError("Signing identity protection requires a user identifier.");
  }
}

function assertPassphrase(passphrase: unknown): asserts passphrase is string {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH || passphrase.length > MAX_PASSPHRASE_LENGTH) {
    throw new CipherSpaceCryptoError(
      "invalid_unlock_passphrase",
      `The identity protection password must contain ${MIN_PASSPHRASE_LENGTH} to ${MAX_PASSPHRASE_LENGTH} characters.`
    );
  }
}

function protectionData(context: UserIdentityProtectionContext): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(JSON.stringify([
    "cipherspace.signing-identity-protection",
    PROTECTION_VERSION,
    KDF_ALGORITHM,
    KDF_HASH,
    KDF_ITERATIONS,
    USER_SIGNING_ALGORITHM,
    USER_SIGNING_KEY_VERSION,
    context.userId
  ]));
}

async function deriveProtectionKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const encoded = textEncoder.encode(passphrase);
  try {
    const material = await crypto.subtle.importKey("raw", encoded, KDF_ALGORITHM, false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { hash: KDF_HASH, iterations: KDF_ITERATIONS, name: KDF_ALGORITHM, salt },
      material,
      { length: AES_KEY_LENGTH_BITS, name: NOTE_ENCRYPTION_ALGORITHM },
      false,
      ["decrypt", "encrypt"]
    );
  } finally {
    encoded.fill(0);
  }
}

function validateProtected(value: unknown): {
  ciphertext: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CipherSpaceCryptoError("invalid_protected_identity_key", "Protected signing key must be an object.");
  }
  const record = value as Record<string, unknown>;
  const expected = ["algorithm", "ciphertext", "identityAlgorithm", "identityKeyVersion", "iterations", "kdf", "kdfHash", "nonce", "salt", "version"];
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    record.algorithm !== NOTE_ENCRYPTION_ALGORITHM ||
    record.identityAlgorithm !== USER_SIGNING_ALGORITHM ||
    record.identityKeyVersion !== USER_SIGNING_KEY_VERSION ||
    record.iterations !== KDF_ITERATIONS ||
    record.kdf !== KDF_ALGORITHM ||
    record.kdfHash !== KDF_HASH ||
    record.version !== PROTECTION_VERSION
  ) {
    throw new CipherSpaceCryptoError("invalid_protected_identity_key", "Protected signing key format is invalid.");
  }
  const ciphertext = decodeBase64(record.ciphertext, "ciphertext");
  const nonce = decodeBase64(record.nonce, "nonce");
  const salt = decodeBase64(record.salt, "salt");
  if (
    ciphertext.byteLength <= AES_GCM_TAG_LENGTH_BITS / 8 ||
    ciphertext.byteLength > MAX_PRIVATE_KEY_BYTES ||
    nonce.byteLength !== AES_GCM_NONCE_LENGTH_BYTES ||
    salt.byteLength !== SALT_LENGTH_BYTES
  ) {
    throw new CipherSpaceCryptoError("invalid_protected_identity_key", "Protected signing key length is invalid.");
  }
  return { ciphertext, nonce, salt };
}

export async function protectSigningPrivateKeyBytes(
  privateBytes: Uint8Array<ArrayBuffer>,
  passphrase: string,
  context: UserIdentityProtectionContext
): Promise<ProtectedSigningPrivateKey> {
  assertPassphrase(passphrase);
  assertContext(context);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_LENGTH_BYTES));
  try {
    const key = await deriveProtectionKey(passphrase, salt);
    const ciphertext = await crypto.subtle.encrypt(
      { additionalData: protectionData(context), iv: nonce, name: NOTE_ENCRYPTION_ALGORITHM, tagLength: AES_GCM_TAG_LENGTH_BITS },
      key,
      privateBytes
    );
    return {
      algorithm: NOTE_ENCRYPTION_ALGORITHM,
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      identityAlgorithm: USER_SIGNING_ALGORITHM,
      identityKeyVersion: USER_SIGNING_KEY_VERSION,
      iterations: KDF_ITERATIONS,
      kdf: KDF_ALGORITHM,
      kdfHash: KDF_HASH,
      nonce: encodeBase64(nonce),
      salt: encodeBase64(salt),
      version: PROTECTION_VERSION
    };
  } finally {
    nonce.fill(0);
    salt.fill(0);
  }
}

export async function importSigningPublicKey(identity: PublicUserSigningIdentity): Promise<CryptoKey> {
  if (identity.algorithm !== USER_SIGNING_ALGORITHM || identity.keyVersion !== USER_SIGNING_KEY_VERSION) {
    throw new CipherSpaceCryptoError("invalid_public_identity_key", "The signing identity algorithm or version is unsupported.");
  }
  const bytes = decodeBase64(identity.publicKey, "signing public key");
  if (bytes.byteLength > MAX_PUBLIC_KEY_BYTES) {
    bytes.fill(0);
    throw new CipherSpaceCryptoError("invalid_public_identity_key", "The signing public key is invalid.");
  }
  try {
    return await crypto.subtle.importKey("spki", bytes, { name: SIGNING_ALGORITHM, namedCurve: SIGNING_CURVE }, false, ["verify"]);
  } catch (error) {
    throw new CipherSpaceCryptoError("invalid_public_identity_key", "The signing public key is invalid.", { cause: error });
  } finally {
    bytes.fill(0);
  }
}

export async function decryptProtectedSigningPrivateKeyBytes(
  identity: LocalUserSigningIdentity,
  passphrase: string,
  context: UserIdentityProtectionContext
): Promise<Uint8Array<ArrayBuffer>> {
  assertPassphrase(passphrase);
  assertContext(context);
  const { ciphertext, nonce, salt } = validateProtected(identity.protectedPrivateKey);
  let privateBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    const key = await deriveProtectionKey(passphrase, salt);
    privateBytes = new Uint8Array(await crypto.subtle.decrypt(
      { additionalData: protectionData(context), iv: nonce, name: NOTE_ENCRYPTION_ALGORITHM, tagLength: AES_GCM_TAG_LENGTH_BITS },
      key,
      ciphertext
    ));
    const privateKey = await crypto.subtle.importKey("pkcs8", privateBytes, { name: SIGNING_ALGORITHM, namedCurve: SIGNING_CURVE }, false, ["sign"]);
    const publicKey = await importSigningPublicKey(identity);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const signature = await crypto.subtle.sign({ hash: SIGNING_HASH, name: SIGNING_ALGORITHM }, privateKey, challenge);
    const valid = await crypto.subtle.verify({ hash: SIGNING_HASH, name: SIGNING_ALGORITHM }, publicKey, signature, challenge);
    challenge.fill(0);
    if (!valid) throw new Error("Signing key pair mismatch.");
    return privateBytes;
  } catch (error) {
    privateBytes?.fill(0);
    throw new CipherSpaceCryptoError("identity_key_unlock_failed", "The local signing identity could not be unlocked.", { cause: error });
  } finally {
    ciphertext.fill(0);
    nonce.fill(0);
    salt.fill(0);
  }
}

export async function verifySigningPrivateKeyBytes(
  privateBytes: Uint8Array<ArrayBuffer>,
  identity: PublicUserSigningIdentity
): Promise<void> {
  try {
    const privateKey = await crypto.subtle.importKey("pkcs8", privateBytes, { name: SIGNING_ALGORITHM, namedCurve: SIGNING_CURVE }, false, ["sign"]);
    const publicKey = await importSigningPublicKey(identity);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    try {
      const signature = await crypto.subtle.sign({ hash: SIGNING_HASH, name: SIGNING_ALGORITHM }, privateKey, challenge);
      if (!(await crypto.subtle.verify({ hash: SIGNING_HASH, name: SIGNING_ALGORITHM }, publicKey, signature, challenge))) {
        throw new Error("Signing key pair mismatch.");
      }
    } finally {
      challenge.fill(0);
    }
  } catch (error) {
    throw new CipherSpaceCryptoError("identity_key_unlock_failed", "The signing private key does not match its public key.", { cause: error });
  }
}

export async function unlockUserSigningIdentity(
  identity: LocalUserSigningIdentity,
  passphrase: string,
  context: UserIdentityProtectionContext
): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    bytes = await decryptProtectedSigningPrivateKeyBytes(identity, passphrase, context);
    return await crypto.subtle.importKey("pkcs8", bytes, { name: SIGNING_ALGORITHM, namedCurve: SIGNING_CURVE }, false, ["sign"]);
  } finally {
    bytes?.fill(0);
  }
}

export async function createUserSigningIdentity(
  passphrase: string,
  context: UserIdentityProtectionContext
): Promise<LocalUserSigningIdentity> {
  assertPassphrase(passphrase);
  assertContext(context);
  let privateBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    const pair = await crypto.subtle.generateKey({ name: SIGNING_ALGORITHM, namedCurve: SIGNING_CURVE }, true, ["sign", "verify"]);
    const [publicBuffer, privateBuffer] = await Promise.all([
      crypto.subtle.exportKey("spki", pair.publicKey),
      crypto.subtle.exportKey("pkcs8", pair.privateKey)
    ]);
    privateBytes = new Uint8Array(privateBuffer);
    return {
      algorithm: USER_SIGNING_ALGORITHM,
      keyVersion: USER_SIGNING_KEY_VERSION,
      protectedPrivateKey: await protectSigningPrivateKeyBytes(privateBytes, passphrase, context),
      publicKey: encodeBase64(new Uint8Array(publicBuffer))
    };
  } catch (error) {
    if (error instanceof CipherSpaceCryptoError) throw error;
    throw new CipherSpaceCryptoError("identity_key_generation_failed", "User signing identity generation failed.", { cause: error });
  } finally {
    privateBytes?.fill(0);
  }
}

export async function signIdentityBytes(privateKey: CryptoKey, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  try {
    const signature = await crypto.subtle.sign({ hash: SIGNING_HASH, name: SIGNING_ALGORITHM }, privateKey, bytes);
    return encodeBase64(new Uint8Array(signature));
  } catch (error) {
    throw new CipherSpaceCryptoError("identity_key_unlock_failed", "Identity signing failed.", { cause: error });
  }
}

export async function verifyIdentitySignature(
  publicIdentity: PublicUserSigningIdentity,
  signatureValue: string,
  bytes: Uint8Array<ArrayBuffer>
): Promise<boolean> {
  const signature = decodeBase64(signatureValue, "signature");
  if (signature.byteLength !== 64) {
    signature.fill(0);
    return false;
  }
  try {
    const publicKey = await importSigningPublicKey(publicIdentity);
    return await crypto.subtle.verify({ hash: SIGNING_HASH, name: SIGNING_ALGORITHM }, publicKey, signature, bytes);
  } catch {
    return false;
  } finally {
    signature.fill(0);
  }
}
