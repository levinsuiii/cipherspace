import type { CryptoErrorCode } from "./types.js";

export class CipherSpaceCryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CipherSpaceCryptoError";
    this.code = code;
  }
}
