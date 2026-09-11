import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createPersonalVerificationCode,
  createUserCryptoIdentity
} from "@cipherspace/crypto";

import { localDatabase } from "./database";
import { LocalIdentityPinRepository } from "./identityPinRepository";

const verifierUserId = "00000000-0000-4000-8000-000000000001";
const subjectUserId = "00000000-0000-4000-8000-000000000002";
const contactEmail = "recipient@example.com";

beforeEach(async () => {
  await localDatabase.delete();
  await localDatabase.open();
});

afterEach(async () => {
  await localDatabase.delete();
});

describe("local identity verification pins", () => {
  it("pins only the independently supplied code and rejects a same-account server substitution", async () => {
    const [trusted, substituted] = await Promise.all([
      createUserCryptoIdentity("trusted identity password", { userId: subjectUserId }),
      createUserCryptoIdentity("substituted identity password", { userId: subjectUserId })
    ]);
    const repository = new LocalIdentityPinRepository(localDatabase, verifierUserId);
    const trustedCode = createPersonalVerificationCode(trusted.identityBundle!);

    await expect(repository.verifyFromIndependentCode(
      trusted.identityBundle!,
      trustedCode,
      "cipherspace-verify:server-supplied-value"
    )).rejects.toThrow("stimmt nicht");
    await expect(repository.get(subjectUserId)).resolves.toBeUndefined();

    await repository.verifyFromIndependentCode(
      trusted.identityBundle!,
      trustedCode,
      trustedCode,
      `  ${contactEmail.toUpperCase()} `
    );
    await expect(repository.getByVerifiedContact(contactEmail)).resolves.toMatchObject({
      subject_user_id: subjectUserId,
      verified_contact_email: contactEmail
    });
    await expect(repository.requireVerified(trusted.identityBundle!)).resolves.toMatchObject({ userId: subjectUserId });
    await expect(repository.requireVerified(substituted.identityBundle!)).rejects.toThrow();
  }, 30_000);

  it("does not let a verified contact silently switch to another pinned user", async () => {
    const otherSubjectUserId = "00000000-0000-4000-8000-000000000003";
    const [trusted, other] = await Promise.all([
      createUserCryptoIdentity("trusted identity password", { userId: subjectUserId }),
      createUserCryptoIdentity("other identity password", { userId: otherSubjectUserId })
    ]);
    const repository = new LocalIdentityPinRepository(localDatabase, verifierUserId);
    const trustedCode = createPersonalVerificationCode(trusted.identityBundle!);
    const otherCode = createPersonalVerificationCode(other.identityBundle!);

    await repository.verifyFromIndependentCode(
      trusted.identityBundle!, trustedCode, trustedCode, contactEmail
    );
    await expect(repository.verifyFromIndependentCode(
      other.identityBundle!, otherCode, otherCode, contactEmail
    )).rejects.toThrow("bereits mit einer anderen Identität");
    await expect(repository.getByVerifiedContact(contactEmail)).resolves.toMatchObject({
      subject_user_id: subjectUserId
    });
  }, 30_000);

  it("keeps legacy pins usable by user ID but fails closed for contact selection", async () => {
    const trusted = await createUserCryptoIdentity("trusted identity password", { userId: subjectUserId });
    const repository = new LocalIdentityPinRepository(localDatabase, verifierUserId);
    const trustedCode = createPersonalVerificationCode(trusted.identityBundle!);

    await repository.verifyFromIndependentCode(trusted.identityBundle!, trustedCode, trustedCode);

    await expect(repository.requireVerified(trusted.identityBundle!)).resolves.toMatchObject({
      userId: subjectUserId
    });
    await expect(repository.getByVerifiedContact(contactEmail)).resolves.toBeUndefined();
  }, 30_000);

  it("does not implicitly rebind a pinned identity to a different contact", async () => {
    const trusted = await createUserCryptoIdentity("trusted identity password", { userId: subjectUserId });
    const repository = new LocalIdentityPinRepository(localDatabase, verifierUserId);
    const trustedCode = createPersonalVerificationCode(trusted.identityBundle!);

    await repository.verifyFromIndependentCode(
      trusted.identityBundle!, trustedCode, trustedCode, contactEmail
    );
    await expect(repository.verifyFromIndependentCode(
      trusted.identityBundle!, trustedCode, trustedCode, "different@example.com"
    )).rejects.toThrow("bereits mit einem anderen verifizierten Kontakt");
  }, 30_000);
});
