import { describe, expect, it } from "vitest";

import {
  decryptCommentContent,
  decryptNoteContent,
  encryptCommentContent,
  generateWorkspaceKey
} from "../src/index.js";

describe("encrypted comment content", () => {
  it("round-trips Unicode content and generates a fresh nonce", async () => {
    const key = await generateWorkspaceKey();
    const first = await encryptCommentContent("Review this paragraph 🔐", key);
    const second = await encryptCommentContent("Review this paragraph 🔐", key);

    expect(await decryptCommentContent(first, key)).toBe("Review this paragraph 🔐");
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("authenticates comments separately from note envelopes", async () => {
    const key = await generateWorkspaceKey();
    const comment = await encryptCommentContent("context-bound comment", key);

    await expect(decryptNoteContent(comment, key)).rejects.toMatchObject({
      code: "decryption_failed"
    });
  });
});
