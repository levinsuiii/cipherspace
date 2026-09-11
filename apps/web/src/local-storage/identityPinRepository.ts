import {
  verifyIdentityBundle,
  verifyIdentityBundleAgainstPin,
  type PublicIdentityBundle,
  type VerifiedIdentityBundle
} from "@cipherspace/crypto";

import type { CipherSpaceLocalDatabase } from "./database";
import type { LocalIdentityPin } from "./types";

function pinKey(verifierUserId: string, subjectUserId: string): string {
  return `${verifierUserId}:${subjectUserId}`;
}

function normalizeContactEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class LocalIdentityPinRepository {
  public constructor(
    private readonly database: CipherSpaceLocalDatabase,
    private readonly verifierUserId: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  public get(subjectUserId: string): Promise<LocalIdentityPin | undefined> {
    return this.database.identity_pins.get(pinKey(this.verifierUserId, subjectUserId));
  }

  public getByVerifiedContact(email: string): Promise<LocalIdentityPin | undefined> {
    return this.database.identity_pins
      .where("[verifier_user_id+verified_contact_email]")
      .equals([this.verifierUserId, normalizeContactEmail(email)])
      .first();
  }

  public async verifyFromIndependentCode(
    bundle: PublicIdentityBundle,
    expectedCode: string,
    actualCode: string,
    contactEmail?: string
  ): Promise<LocalIdentityPin> {
    await verifyIdentityBundle(bundle);
    if (expectedCode !== actualCode) {
      throw new Error("Der unabhängige Verifizierungscode stimmt nicht mit der Server-Identität überein.");
    }
    const existing = await this.get(bundle.userId);
    if (existing && existing.signing_key_fingerprint !== bundle.signingKey.fingerprint) {
      throw new Error("Der langfristige Signaturschlüssel hat sich unerwartet geändert.");
    }
    const normalizedContactEmail = contactEmail ? normalizeContactEmail(contactEmail) : undefined;
    if (
      normalizedContactEmail &&
      existing?.verified_contact_email &&
      existing.verified_contact_email !== normalizedContactEmail
    ) {
      throw new Error("Diese Identität ist bereits mit einem anderen verifizierten Kontakt verbunden.");
    }
    if (normalizedContactEmail) {
      const existingContact = await this.getByVerifiedContact(normalizedContactEmail);
      if (existingContact && existingContact.subject_user_id !== bundle.userId) {
        throw new Error("Dieser verifizierte Kontakt ist bereits mit einer anderen Identität verbunden.");
      }
    }
    const timestamp = this.now();
    const pin: LocalIdentityPin = {
      bundle_hash: bundle.bundleHash,
      bundle_sequence: bundle.bundleSequence,
      encryption_key_fingerprint: bundle.encryptionKey.fingerprint,
      key: pinKey(this.verifierUserId, bundle.userId),
      signing_key_algorithm: bundle.signingKey.algorithm,
      signing_key_fingerprint: bundle.signingKey.fingerprint,
      signing_key_public_key: bundle.signingKey.publicKey,
      status: "verified",
      subject_user_id: bundle.userId,
      updated_at: timestamp,
      verified_contact_email: normalizedContactEmail ?? existing?.verified_contact_email,
      verification_method: "verification_code",
      verified_at: existing?.verified_at ?? timestamp,
      verifier_user_id: this.verifierUserId
    };
    await this.database.identity_pins.put(pin);
    return pin;
  }

  public async requireVerified(bundle: PublicIdentityBundle): Promise<VerifiedIdentityBundle> {
    const pin = await this.get(bundle.userId);
    if (!pin) throw new Error("Diese Identität wurde auf diesem Gerät noch nicht unabhängig verifiziert.");
    return verifyIdentityBundleAgainstPin(bundle, {
      bundleHash: pin.bundle_hash,
      bundleSequence: pin.bundle_sequence,
      encryptionKeyFingerprint: pin.encryption_key_fingerprint,
      signingKeyFingerprint: pin.signing_key_fingerprint,
      status: pin.status,
      subjectUserId: pin.subject_user_id
    });
  }

  public async requireVerifiedContact(
    email: string,
    returnedUserId: string,
    bundle: PublicIdentityBundle,
    expectedUserId?: string
  ): Promise<VerifiedIdentityBundle> {
    const pin = await this.getByVerifiedContact(email);
    if (!pin) {
      throw new Error("Dieser Kontakt wurde auf diesem Gerät noch nicht unabhängig verifiziert.");
    }
    if (expectedUserId && pin.subject_user_id !== expectedUserId) {
      throw new Error("Das ausgewählte Mitglied gehört nicht zum lokal verifizierten Kontakt.");
    }
    if (returnedUserId !== pin.subject_user_id || bundle.userId !== pin.subject_user_id) {
      throw new Error("Die Server-Antwort gehört nicht zum lokal verifizierten Kontakt.");
    }
    return verifyIdentityBundleAgainstPin(bundle, {
      bundleHash: pin.bundle_hash,
      bundleSequence: pin.bundle_sequence,
      encryptionKeyFingerprint: pin.encryption_key_fingerprint,
      signingKeyFingerprint: pin.signing_key_fingerprint,
      status: pin.status,
      subjectUserId: pin.subject_user_id
    });
  }
}
