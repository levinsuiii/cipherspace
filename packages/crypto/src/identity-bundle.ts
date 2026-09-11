import {
  IDENTITY_BUNDLE_VERSION,
  USER_IDENTITY_ALGORITHM,
  USER_IDENTITY_KEY_VERSION,
  USER_SIGNING_ALGORITHM,
  USER_SIGNING_KEY_VERSION
} from "./constants.js";
import { decodeBase64, encodeBase64 } from "./encoding.js";
import { CipherSpaceCryptoError } from "./errors.js";
import { signIdentityBytes, verifyIdentitySignature } from "./signing-identity.js";
import type {
  PublicIdentityBundle,
  PublicUserCryptoIdentity,
  PublicUserSigningIdentity,
  VerifiedIdentityBundle
} from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX_PATTERN = /^[0-9a-f]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const textEncoder = new TextEncoder();
const verifiedBundles = new WeakSet<object>();

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

async function assertCanonicalPublicKeys(bundle: PublicIdentityBundle): Promise<void> {
  try {
    const [signingKey, encryptionKey] = await Promise.all([
      crypto.subtle.importKey(
        "spki",
        decodeBase64(bundle.signingKey.publicKey, "signing public key"),
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"]
      ),
      crypto.subtle.importKey(
        "spki",
        decodeBase64(bundle.encryptionKey.publicKey, "encryption public key"),
        { hash: "SHA-256", name: "RSA-OAEP" },
        true,
        ["wrapKey"]
      )
    ]);
    const signingAlgorithm = signingKey.algorithm as EcKeyAlgorithm;
    const encryptionAlgorithm = encryptionKey.algorithm as RsaHashedKeyAlgorithm;
    const exponent = new Uint8Array(encryptionAlgorithm.publicExponent);
    if (
      signingAlgorithm.name !== "ECDSA" || signingAlgorithm.namedCurve !== "P-256" ||
      encryptionAlgorithm.name !== "RSA-OAEP" || encryptionAlgorithm.hash.name !== "SHA-256" ||
      encryptionAlgorithm.modulusLength !== 3_072 ||
      exponent.length !== 3 || exponent[0] !== 1 || exponent[1] !== 0 || exponent[2] !== 1
    ) {
      throw new Error("Unsupported public key parameters");
    }
    const [canonicalSigningKey, canonicalEncryptionKey] = await Promise.all([
      crypto.subtle.exportKey("spki", signingKey),
      crypto.subtle.exportKey("spki", encryptionKey)
    ]);
    if (
      encodeBase64(new Uint8Array(canonicalSigningKey)) !== bundle.signingKey.publicKey ||
      encodeBase64(new Uint8Array(canonicalEncryptionKey)) !== bundle.encryptionKey.publicKey
    ) {
      throw new Error("Non-canonical public key encoding");
    }
  } catch (error) {
    throw new CipherSpaceCryptoError("invalid_public_identity_key", "The identity bundle contains an invalid public key.", { cause: error });
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function publicKeyFingerprint(algorithm: string, canonicalBase64Spki: string): Promise<string> {
  return sha256Hex(textEncoder.encode(JSON.stringify([
    "cipherspace.public-key-fingerprint",
    1,
    algorithm,
    canonicalBase64Spki
  ])));
}

export function identityBundleCanonicalBytes(bundle: Omit<PublicIdentityBundle, "bundleHash" | "signature">): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(JSON.stringify([
    "cipherspace.identity-bundle",
    bundle.bundleVersion,
    bundle.userId,
    bundle.bundleSequence,
    bundle.previousBundleHash,
    bundle.createdAt,
    bundle.signingKey.algorithm,
    bundle.signingKey.keyVersion,
    bundle.signingKey.publicKey,
    bundle.signingKey.fingerprint,
    bundle.encryptionKey.algorithm,
    bundle.encryptionKey.keyVersion,
    bundle.encryptionKey.publicKey,
    bundle.encryptionKey.fingerprint
  ]));
}

function assertBundleShape(bundle: PublicIdentityBundle): void {
  if (
    !bundle ||
    !hasExactKeys(bundle, ["bundleHash", "bundleSequence", "bundleVersion", "createdAt", "encryptionKey", "previousBundleHash", "signature", "signingKey", "userId"]) ||
    bundle.bundleVersion !== IDENTITY_BUNDLE_VERSION ||
    !UUID_PATTERN.test(bundle.userId) ||
    !Number.isSafeInteger(bundle.bundleSequence) || bundle.bundleSequence < 1 ||
    (bundle.previousBundleHash !== null && !HEX_PATTERN.test(bundle.previousBundleHash)) ||
    !ISO_DATE_PATTERN.test(bundle.createdAt) ||
    !hasExactKeys(bundle.signingKey, ["algorithm", "fingerprint", "keyVersion", "publicKey"]) ||
    bundle.signingKey.algorithm !== USER_SIGNING_ALGORITHM ||
    bundle.signingKey.keyVersion !== USER_SIGNING_KEY_VERSION ||
    typeof bundle.signingKey.publicKey !== "string" || bundle.signingKey.publicKey.length > 512 ||
    !HEX_PATTERN.test(bundle.signingKey.fingerprint) ||
    !hasExactKeys(bundle.encryptionKey, ["algorithm", "fingerprint", "keyVersion", "publicKey"]) ||
    bundle.encryptionKey.algorithm !== USER_IDENTITY_ALGORITHM ||
    bundle.encryptionKey.keyVersion !== USER_IDENTITY_KEY_VERSION ||
    typeof bundle.encryptionKey.publicKey !== "string" || bundle.encryptionKey.publicKey.length > 2_048 ||
    !HEX_PATTERN.test(bundle.encryptionKey.fingerprint) ||
    !HEX_PATTERN.test(bundle.bundleHash) ||
    !hasExactKeys(bundle.signature, ["algorithm", "value"]) ||
    bundle.signature.algorithm !== USER_SIGNING_ALGORITHM ||
    typeof bundle.signature.value !== "string"
  ) {
    throw new CipherSpaceCryptoError("invalid_public_identity_key", "The identity bundle is malformed or unsupported.");
  }
  if ((bundle.bundleSequence === 1) !== (bundle.previousBundleHash === null)) {
    throw new CipherSpaceCryptoError("invalid_public_identity_key", "The identity bundle chain is invalid.");
  }
}

export async function createIdentityBundle(input: {
  bundleSequence?: number;
  createdAt?: string;
  encryptionIdentity: PublicUserCryptoIdentity;
  previousBundleHash?: string | null;
  signingIdentity: PublicUserSigningIdentity;
  signingPrivateKey: CryptoKey;
  userId: string;
}): Promise<PublicIdentityBundle> {
  const bundleSequence = input.bundleSequence ?? 1;
  const unsigned = {
    bundleSequence,
    bundleVersion: IDENTITY_BUNDLE_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    encryptionKey: {
      algorithm: input.encryptionIdentity.algorithm,
      fingerprint: await publicKeyFingerprint(input.encryptionIdentity.algorithm, input.encryptionIdentity.publicKey),
      keyVersion: input.encryptionIdentity.keyVersion,
      publicKey: input.encryptionIdentity.publicKey
    },
    previousBundleHash: input.previousBundleHash ?? null,
    signingKey: {
      algorithm: input.signingIdentity.algorithm,
      fingerprint: await publicKeyFingerprint(input.signingIdentity.algorithm, input.signingIdentity.publicKey),
      keyVersion: input.signingIdentity.keyVersion,
      publicKey: input.signingIdentity.publicKey
    },
    userId: input.userId
  };
  const canonical = identityBundleCanonicalBytes(unsigned);
  const bundle: PublicIdentityBundle = {
    ...unsigned,
    bundleHash: await sha256Hex(canonical),
    signature: {
      algorithm: USER_SIGNING_ALGORITHM,
      value: await signIdentityBytes(input.signingPrivateKey, canonical)
    }
  };
  await verifyIdentityBundle(bundle);
  return bundle;
}

export async function verifyIdentityBundle(bundle: PublicIdentityBundle): Promise<void> {
  assertBundleShape(bundle);
  const unsigned = {
    bundleSequence: bundle.bundleSequence,
    bundleVersion: bundle.bundleVersion,
    createdAt: bundle.createdAt,
    encryptionKey: bundle.encryptionKey,
    previousBundleHash: bundle.previousBundleHash,
    signingKey: bundle.signingKey,
    userId: bundle.userId
  };
  const canonical = identityBundleCanonicalBytes(unsigned);
  const [signingFingerprint, encryptionFingerprint, bundleHash] = await Promise.all([
    publicKeyFingerprint(bundle.signingKey.algorithm, bundle.signingKey.publicKey),
    publicKeyFingerprint(bundle.encryptionKey.algorithm, bundle.encryptionKey.publicKey),
    sha256Hex(canonical),
    assertCanonicalPublicKeys(bundle)
  ]);
  if (
    signingFingerprint !== bundle.signingKey.fingerprint ||
    encryptionFingerprint !== bundle.encryptionKey.fingerprint ||
    bundleHash !== bundle.bundleHash ||
    !(await verifyIdentitySignature(bundle.signingKey, bundle.signature.value, canonical))
  ) {
    throw new CipherSpaceCryptoError("invalid_public_identity_key", "The identity bundle signature or fingerprint is invalid.");
  }
}

export async function verifyIdentityBundleAgainstPin(bundle: PublicIdentityBundle, pin: {
  bundleHash: string;
  bundleSequence: number;
  encryptionKeyFingerprint: string;
  signingKeyFingerprint: string;
  status: "verified";
  subjectUserId: string;
}): Promise<VerifiedIdentityBundle> {
  await verifyIdentityBundle(bundle);
  if (
    bundle.userId !== pin.subjectUserId ||
    bundle.signingKey.fingerprint !== pin.signingKeyFingerprint ||
    bundle.bundleSequence !== pin.bundleSequence ||
    bundle.bundleHash !== pin.bundleHash ||
    bundle.encryptionKey.fingerprint !== pin.encryptionKeyFingerprint
  ) {
    throw new CipherSpaceCryptoError("invalid_public_identity_key", "The identity bundle does not match the independently verified local pin.");
  }
  verifiedBundles.add(bundle);
  return bundle as VerifiedIdentityBundle;
}

export function assertVerifiedIdentityBundle(bundle: PublicIdentityBundle): asserts bundle is VerifiedIdentityBundle {
  if (!verifiedBundles.has(bundle)) {
    throw new CipherSpaceCryptoError("invalid_public_identity_key", "The recipient identity was not independently verified on this device.");
  }
}

export async function verifyOwnIdentityBundle(
  bundle: PublicIdentityBundle,
  local: {
    encryptionPublicKey: string;
    signingPublicKey: string;
    userId: string;
  }
): Promise<VerifiedIdentityBundle> {
  await verifyIdentityBundle(bundle);
  if (
    bundle.userId !== local.userId ||
    bundle.encryptionKey.publicKey !== local.encryptionPublicKey ||
    bundle.signingKey.publicKey !== local.signingPublicKey
  ) {
    throw new CipherSpaceCryptoError("invalid_public_identity_key", "The self-share identity does not match the local account keys.");
  }
  verifiedBundles.add(bundle);
  return bundle as VerifiedIdentityBundle;
}

export function createPersonalVerificationCode(bundle: PublicIdentityBundle): string {
  const payload = textEncoder.encode(JSON.stringify([
    "cipherspace.identity-verification",
    1,
    bundle.userId,
    bundle.signingKey.fingerprint,
    bundle.bundleSequence,
    bundle.bundleHash,
    bundle.encryptionKey.fingerprint,
    bundle.encryptionKey.keyVersion
  ]));
  return `cipherspace-verify:${encodeBase64(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "")}`;
}

export async function safetyNumberForVerificationCode(code: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(code)));
  let value = 0n;
  for (const byte of digest) value = (value << 8n) | BigInt(byte);
  return (value % (10n ** 60n)).toString().padStart(60, "0").match(/.{5}/g)!.join(" ");
}
