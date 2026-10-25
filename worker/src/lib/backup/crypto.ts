/**
 * Passphrase encryption for export files (parent issue ONE-358
 * "敏感性与加密" section).
 *
 * Built only from WebCrypto primitives — no hand-rolled cryptography:
 *
 *   key  = PBKDF2(passphrase, salt, iterations, SHA-256) → AES-GCM-256
 *   salt = 16 random bytes, iv = 12 random bytes
 *   payload = base64(AES-GCM ciphertext || 128-bit tag)
 *
 * Envelope (the encrypted file is recognizable without the passphrase):
 *
 * {
 *   "format": "enotify-export-encrypted",
 *   "format_version": 1,
 *   "kdf":   { "name": "PBKDF2", "hash": "SHA-256", "iterations": 210000,
 *              "salt": "<base64>" },
 *   "cipher":{ "name": "AES-GCM", "length": 256, "iv": "<base64>",
 *              "tag_length": 128 },
 *   "payload": "<base64>"
 * }
 *
 * The passphrase itself is never stored, echoed, or logged; a wrong passphrase
 * fails inside AES-GCM authentication and surfaces as DECRYPT_FAILED before
 * any database access happens (zero writes).
 */
import { BackupError } from "./errors";
import { BACKUP_ENCRYPTED_FORMAT, BACKUP_FORMAT_VERSION } from "./format";

export const PBKDF2_ITERATIONS = 210_000;
export const PBKDF2_HASH = "SHA-256";
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const AES_KEY_LENGTH = 256;
export const TAG_LENGTH = 128;

// Bounds accepted when reading a foreign envelope. The floor is the spec's
// "迭代次数 ≥ 210,000"; the ceiling keeps a hostile file from pinning a Worker
// in PBKDF2 indefinitely.
const MIN_ACCEPTED_ITERATIONS = 210_000;
const MAX_ACCEPTED_ITERATIONS = 10_000_000;

export interface ExportKdf {
  name: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  salt: string;
}

export interface ExportCipher {
  name: "AES-GCM";
  length: number;
  iv: string;
  tag_length: number;
}

export interface EncryptedExportFile {
  format: typeof BACKUP_ENCRYPTED_FORMAT;
  format_version: number;
  kdf: ExportKdf;
  cipher: ExportCipher;
  payload: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new BackupError(
      "INVALID_ENVELOPE",
      400,
      "加密信封内的 base64 字段无效",
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: PBKDF2_HASH,
    },
    material,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypts the serialized plain export file into an envelope. */
export async function encryptExport(
  plain: unknown,
  passphrase: string,
): Promise<EncryptedExportFile> {
  if (!passphrase) {
    throw new BackupError("PASSPHRASE_REQUIRED", 400, "加密导出必须提供口令");
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);

  const plaintext = new TextEncoder().encode(JSON.stringify(plain));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, tagLength: TAG_LENGTH },
    key,
    plaintext as BufferSource,
  );

  return {
    format: BACKUP_ENCRYPTED_FORMAT,
    format_version: BACKUP_FORMAT_VERSION,
    kdf: {
      name: "PBKDF2",
      hash: PBKDF2_HASH,
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    cipher: {
      name: "AES-GCM",
      length: AES_KEY_LENGTH,
      iv: bytesToBase64(iv),
      tag_length: TAG_LENGTH,
    },
    payload: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export function isEncryptedEnvelope(
  input: unknown,
): input is EncryptedExportFile {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    (input as Record<string, unknown>).format === BACKUP_ENCRYPTED_FORMAT
  );
}

/** Validates the envelope shape and returns its parsed KDF/cipher params. */
function readEnvelope(envelope: unknown): {
  salt: Uint8Array;
  iv: Uint8Array;
  iterations: number;
  payload: Uint8Array;
  version: number;
} {
  const invalid = (message: string): never => {
    throw new BackupError("INVALID_ENVELOPE", 400, message);
  };
  if (!isEncryptedEnvelope(envelope))
    invalid("文件不是加密的 eNotify 导出信封");

  const env = envelope as EncryptedExportFile;

  const version = env.format_version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    invalid("加密信封缺少有效的 format_version");
  if (version > BACKUP_FORMAT_VERSION)
    throw new BackupError(
      "UNSUPPORTED_FORMAT_VERSION",
      400,
      `加密信封 format_version 为 ${version}，本服务最高支持 ${BACKUP_FORMAT_VERSION}`,
      { file_format_version: version, supported: BACKUP_FORMAT_VERSION },
    );

  const kdf = env.kdf;
  if (kdf?.name !== "PBKDF2" || kdf.hash !== PBKDF2_HASH)
    invalid("加密信封的 kdf 参数不受支持（需要 PBKDF2 + SHA-256）");
  const iterations = kdf.iterations;
  if (
    typeof iterations !== "number" ||
    !Number.isInteger(iterations) ||
    iterations < MIN_ACCEPTED_ITERATIONS ||
    iterations > MAX_ACCEPTED_ITERATIONS
  )
    invalid(
      `加密信封的 PBKDF2 迭代次数不受支持（需 ${MIN_ACCEPTED_ITERATIONS}–${MAX_ACCEPTED_ITERATIONS}）`,
    );

  const cipher = env.cipher;
  if (cipher?.name !== "AES-GCM" || cipher.length !== AES_KEY_LENGTH)
    invalid("加密信封的 cipher 参数不受支持（需要 AES-GCM-256）");

  if (typeof kdf.salt !== "string" || typeof env.payload !== "string")
    invalid("加密信封缺少 salt 或 payload");

  const salt = base64ToBytes(kdf.salt);
  if (salt.length !== SALT_BYTES)
    invalid(`加密信封的 salt 必须是 ${SALT_BYTES} 字节`);
  const iv = base64ToBytes(String(cipher.iv));
  if (iv.length !== IV_BYTES) invalid(`加密信封的 iv 必须是 ${IV_BYTES} 字节`);
  const payload = base64ToBytes(env.payload);
  if (payload.length <= TAG_LENGTH / 8) invalid("加密信封的 payload 长度无效");

  return { salt, iv, iterations, payload, version };
}

/**
 * Decrypts an envelope and returns the parsed plain export object.
 *
 * A wrong passphrase (or a corrupted payload) is indistinguishable by design
 * and always reports DECRYPT_FAILED; nothing is written anywhere first.
 */
export async function decryptExport(
  envelope: unknown,
  passphrase: string,
): Promise<unknown> {
  if (!passphrase) {
    throw new BackupError(
      "PASSPHRASE_REQUIRED",
      400,
      "该文件已加密，请提供口令",
      { encrypted: true },
    );
  }
  const { salt, iv, iterations, payload } = readEnvelope(envelope);
  const key = await deriveKey(passphrase, salt, iterations);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource, tagLength: TAG_LENGTH },
      key,
      payload as BufferSource,
    );
  } catch {
    throw new BackupError(
      "DECRYPT_FAILED",
      400,
      "口令错误或文件已损坏，未能解密（未写入任何数据）",
    );
  }

  try {
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new BackupError("INVALID_FILE", 400, "解密成功但内容不是有效的 JSON");
  }
}
