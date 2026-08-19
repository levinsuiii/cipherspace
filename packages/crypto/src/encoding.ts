import { CipherSpaceCryptoError } from "./errors.js";

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function decodeBase64(value: unknown, fieldName: string): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    throw new CipherSpaceCryptoError(
      "invalid_payload",
      `${fieldName} must be canonical base64.`
    );
  }

  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (encodeBase64(bytes) !== value) {
      throw new Error("Non-canonical base64 encoding.");
    }
    return bytes;
  } catch (error) {
    throw new CipherSpaceCryptoError(
      "invalid_payload",
      `${fieldName} must be canonical base64.`,
      { cause: error }
    );
  }
}
