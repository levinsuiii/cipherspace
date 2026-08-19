import { describe, expect, it } from "vitest";

import {
  AES_GCM_NONCE_LENGTH_BYTES,
  CipherSpaceCryptoError,
  decryptNoteContent,
  encryptNoteContent,
  generateWorkspaceKey,
  type EncryptedNotePayload
} from "../src/index.js";

describe("note content encryption", () => {
  it("round-trips Unicode note content", async () => {
    const key = await generateWorkspaceKey();
    const plaintext = "CipherSpace note: caf\u00e9, \u6771\u4eac, and \ud83d\udd10";

    const payload = await encryptNoteContent(plaintext, key);

    expect(payload).toEqual({
      algorithm: "AES-GCM",
      ciphertext: expect.any(String),
      envelopeVersion: 1,
      keyVersion: 1,
      nonce: expect.any(String)
    });
    await expect(decryptNoteContent(payload, key)).resolves.toBe(plaintext);
  });

  it("uses a fresh 96-bit nonce for every encryption", async () => {
    const key = await generateWorkspaceKey();

    const first = await encryptNoteContent("same content", key);
    const second = await encryptNoteContent("same content", key);

    expect(first.nonce).not.toBe(second.nonce);
    expect(atob(first.nonce)).toHaveLength(AES_GCM_NONCE_LENGTH_BYTES);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("fails safely when the wrong workspace key is used", async () => {
    const encryptionKey = await generateWorkspaceKey();
    const wrongKey = await generateWorkspaceKey();
    const payload = await encryptNoteContent("content", encryptionKey);

    await expect(decryptNoteContent(payload, wrongKey)).rejects.toMatchObject({
      code: "decryption_failed",
      message: "Note decryption failed because the key or encrypted payload is invalid."
    });
  });

  it("fails safely when authenticated ciphertext is changed", async () => {
    const key = await generateWorkspaceKey();
    const payload = await encryptNoteContent("content", key);
    const ciphertext = atob(payload.ciphertext);
    const changedFirstByte = String.fromCharCode(ciphertext.charCodeAt(0) ^ 1);
    const tampered = {
      ...payload,
      ciphertext: btoa(changedFirstByte + ciphertext.slice(1))
    };

    await expect(decryptNoteContent(tampered, key)).rejects.toMatchObject({
      code: "decryption_failed"
    });
  });

  it.each([
    ["non-object", "not-an-envelope"],
    ["missing fields", { algorithm: "AES-GCM" }],
    [
      "extra fields",
      {
        algorithm: "AES-GCM",
        ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
        envelopeVersion: 1,
        extra: true,
        keyVersion: 1,
        nonce: "AAAAAAAAAAAAAAAA"
      }
    ],
    [
      "unsupported algorithm",
      {
        algorithm: "AES-CBC",
        ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
        envelopeVersion: 1,
        keyVersion: 1,
        nonce: "AAAAAAAAAAAAAAAA"
      }
    ],
    [
      "unsupported envelope version",
      {
        algorithm: "AES-GCM",
        ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
        envelopeVersion: 2,
        keyVersion: 1,
        nonce: "AAAAAAAAAAAAAAAA"
      }
    ],
    [
      "unsupported key version",
      {
        algorithm: "AES-GCM",
        ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
        envelopeVersion: 1,
        keyVersion: 2,
        nonce: "AAAAAAAAAAAAAAAA"
      }
    ],
    [
      "invalid ciphertext base64",
      {
        algorithm: "AES-GCM",
        ciphertext: "not base64",
        envelopeVersion: 1,
        keyVersion: 1,
        nonce: "AAAAAAAAAAAAAAAA"
      }
    ],
    [
      "short ciphertext",
      {
        algorithm: "AES-GCM",
        ciphertext: "AQID",
        envelopeVersion: 1,
        keyVersion: 1,
        nonce: "AAAAAAAAAAAAAAAA"
      }
    ],
    [
      "wrong nonce length",
      {
        algorithm: "AES-GCM",
        ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
        envelopeVersion: 1,
        keyVersion: 1,
        nonce: "AQIDBA=="
      }
    ]
  ])("rejects a malformed payload with %s", async (_caseName, payload) => {
    const key = await generateWorkspaceKey();

    await expect(decryptNoteContent(payload, key)).rejects.toBeInstanceOf(CipherSpaceCryptoError);
    await expect(decryptNoteContent(payload, key)).rejects.toMatchObject({ code: "invalid_payload" });
  });

  it("accepts an empty note body", async () => {
    const key = await generateWorkspaceKey();
    const payload: EncryptedNotePayload = await encryptNoteContent("", key);

    await expect(decryptNoteContent(payload, key)).resolves.toBe("");
  });
});
