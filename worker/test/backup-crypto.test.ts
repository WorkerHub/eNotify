import { describe, expect, it } from "vitest";
import {
  ADMIN,
  BOB,
  SqliteD1,
  callWorker,
  jsonPost,
  makeBackupEnv,
  seedInstance,
} from "./support/backup";
import { cookieHeader, makeToken, seedSession } from "./helpers";
import {
  PBKDF2_ITERATIONS,
  decryptExport,
  encryptExport,
} from "../src/lib/backup/crypto";

async function userCookie(env: any, userId = BOB.id, sid = "sess-bob") {
  const token = await makeToken("user", { sub: userId, sid });
  await seedSession(env, userId, sid);
  return cookieHeader(token);
}

async function adminCookie(env: any) {
  const token = await makeToken("admin", { sub: ADMIN.id, sid: "sess-admin" });
  await seedSession(env, ADMIN.id, "sess-admin");
  return cookieHeader(token);
}

const PLAIN = {
  format: "enotify-export",
  format_version: 1,
  app_version: "1.0.4",
  exported_at: "2026-10-25T15:00:00.000Z",
  scope: "user",
  data: {
    users: [{ id: "u1", email: "a@example.com" }],
    items: [],
    user_2fa: [],
    payment_history: [],
    notification_configs: [],
    system_settings: [],
    notification_history: [],
  },
};

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe("encryption envelope", () => {
  it("carries every field the contract requires", async () => {
    const envelope = await encryptExport(PLAIN, "correct horse");
    const raw = envelope as any;

    expect(raw.format).toBe("enotify-export-encrypted");
    expect(raw.format_version).toBe(1);
    expect(raw.kdf.name).toBe("PBKDF2");
    expect(raw.kdf.hash).toBe("SHA-256");
    expect(raw.kdf.iterations).toBeGreaterThanOrEqual(210_000);
    expect(raw.kdf.iterations).toBe(PBKDF2_ITERATIONS);
    expect(base64Bytes(raw.kdf.salt)).toHaveLength(16);
    expect(raw.cipher.name).toBe("AES-GCM");
    expect(raw.cipher.length).toBe(256);
    expect(base64Bytes(raw.cipher.iv)).toHaveLength(12);
    expect(raw.cipher.tag_length).toBe(128);
    expect(typeof raw.payload).toBe("string");
    expect(base64Bytes(raw.payload).length).toBeGreaterThan(16);
  });

  it("uses a fresh salt and IV for every export", async () => {
    const a = await encryptExport(PLAIN, "same-passphrase");
    const b = await encryptExport(PLAIN, "same-passphrase");
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.payload).not.toBe(b.payload);
  });

  it("round-trips to exactly the plaintext payload", async () => {
    const envelope = await encryptExport(PLAIN, "pässphrase-ü");
    await expect(decryptExport(envelope, "pässphrase-ü")).resolves.toEqual(
      PLAIN,
    );
  });

  it("does not store the passphrase anywhere in the envelope", async () => {
    const passphrase = "unique-passphrase-marker-1234";
    const envelope = await encryptExport(PLAIN, passphrase);
    expect(JSON.stringify(envelope)).not.toContain(passphrase);
  });

  it("rejects an envelope with too few PBKDF2 iterations", async () => {
    const envelope = await encryptExport(PLAIN, "pw");
    const weakened = {
      ...envelope,
      kdf: { ...envelope.kdf, iterations: 1_000 },
    };
    await expect(decryptExport(weakened, "pw")).rejects.toMatchObject({
      code: "INVALID_ENVELOPE",
    });
  });

  it("rejects an envelope with a non-SHA-256 KDF", async () => {
    const envelope = await encryptExport(PLAIN, "pw");
    const swapped = {
      ...envelope,
      kdf: { ...envelope.kdf, hash: "SHA-1" as any },
    };
    await expect(decryptExport(swapped, "pw")).rejects.toMatchObject({
      code: "INVALID_ENVELOPE",
    });
  });
});

describe("encrypted export / import endpoints", () => {
  it("defaults to encryption and refuses to encrypt without a passphrase", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);

    const noPassphrase = await callWorker(
      env,
      "/api/me/export",
      jsonPost({}, await userCookie(env)),
    );
    expect(noPassphrase.status).toBe(400);
    expect(noPassphrase.body.code).toBe("PASSPHRASE_REQUIRED");

    const encrypted = await callWorker(
      env,
      "/api/me/export",
      jsonPost({ passphrase: "pw-123456" }, await userCookie(env)),
    );
    expect(encrypted.status).toBe(200);
    expect(encrypted.body.format).toBe("enotify-export-encrypted");
    expect(encrypted.headers.get("content-disposition")).toContain("encrypted");
  });

  it("reports a clear error and writes nothing when the passphrase is wrong", async () => {
    const source = new SqliteD1();
    seedInstance(source);
    const sourceEnv = makeBackupEnv(source);
    const exported = await callWorker(
      sourceEnv,
      "/api/me/export",
      jsonPost({ passphrase: "right-passphrase" }, await userCookie(sourceEnv)),
    );

    const target = new SqliteD1();
    seedInstance(target);
    const before = JSON.stringify(
      target.select("SELECT * FROM items ORDER BY id"),
    );
    const targetEnv = makeBackupEnv(target);

    const res = await callWorker(
      targetEnv,
      "/api/me/import",
      jsonPost(
        { file: exported.body, passphrase: "wrong-passphrase" },
        await userCookie(targetEnv),
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DECRYPT_FAILED");
    expect(res.body.error).toContain("口令");
    // Zero writes: the database is byte-for-byte unchanged.
    expect(
      JSON.stringify(target.select("SELECT * FROM items ORDER BY id")),
    ).toBe(before);
    expect(target.count("payment_history")).toBe(2);
  });

  it("requires a passphrase to import an encrypted file", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);

    const exported = await callWorker(
      env,
      "/api/me/export",
      jsonPost({ passphrase: "pw" }, await userCookie(env)),
    );
    const res = await callWorker(
      env,
      "/api/me/import",
      jsonPost({ file: exported.body }, await userCookie(env)),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSPHRASE_REQUIRED");
    expect(res.body.details).toEqual({ encrypted: true });
  });

  it("rejects a tampered payload as a decryption failure", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);

    const exported = await callWorker(
      env,
      "/api/admin/export",
      jsonPost({ passphrase: "pw" }, await adminCookie(env)),
    );
    const tampered = {
      ...exported.body,
      payload: btoa("not the real payload"),
    };

    const res = await callWorker(
      env,
      "/api/admin/import",
      jsonPost(
        { mode: "restore", file: tampered, passphrase: "pw" },
        await adminCookie(env),
      ),
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DECRYPT_FAILED");
  });

  it("reports an encrypted file as such when no passphrase was supplied for preview", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);

    const exported = await callWorker(
      env,
      "/api/me/export",
      jsonPost({ passphrase: "pw" }, await userCookie(env)),
    );
    const res = await callWorker(
      env,
      "/api/me/import/preview",
      jsonPost({ file: exported.body }, await userCookie(env)),
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSPHRASE_REQUIRED");
    expect(res.body.details.encrypted).toBe(true);
  });
});
