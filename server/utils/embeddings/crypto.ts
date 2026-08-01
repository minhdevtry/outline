import crypto from "node:crypto";
import env from "@server/env";

/**
 * AES-256-GCM helpers for at-rest encryption of Mistral API keys.
 *
 * The cipher key is derived from Outline's `SECRET_KEY` so that rotating
 * `SECRET_KEY` invalidates all stored keys (caller must re-add). The blob
 * layout on disk is: `[12 bytes IV][16 bytes authTag][ciphertext]`. Inputs and
 * outputs are Node `Buffer`s; plaintext round-trips through UTF-8.
 */

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_DOMAIN = "embedding-keys";

let cachedKey: Buffer | null = null;

function getDerivedKey(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }
  if (!env.SECRET_KEY) {
    throw new Error("SECRET_KEY is required to encrypt embedding keys");
  }
  cachedKey = crypto
    .createHash("sha256")
    .update(env.SECRET_KEY)
    .update(KEY_DOMAIN)
    .digest();
  return cachedKey;
}

/**
 * Encrypts the given plaintext with AES-256-GCM and returns a single buffer
 * containing the IV, auth tag, and ciphertext concatenated. The result is
 * safe to store in a `BYTEA` column.
 *
 * @param plaintext The UTF-8 string to encrypt.
 * @returns Encrypted buffer.
 */
export function encrypt(plaintext: string): Buffer {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Decrypts a buffer produced by `encrypt`. Throws if the buffer is malformed
 * or the auth tag does not verify (e.g. after `SECRET_KEY` was rotated).
 *
 * @param blob The encrypted blob as stored in the database.
 * @returns The original plaintext string.
 */
export function decrypt(blob: Buffer): string {
  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Encrypted blob is too short");
  }
  const key = getDerivedKey();
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
