import type { Context, Next } from "hono";
import {
  API_KEY_PREFIX,
  type ApiKeyIndexRecord,
  type ApiKeyRecord,
  apiKeyIndexKey,
  apiKeyKvKey,
  sha256Hex,
} from "../core/apiKey";
import { findUserById } from "../db/queries/users";
import type { HonoEnv } from "../types";
import { getTablePrefix } from "../types";
import { authMiddleware } from "./auth";
import { rateLimit } from "./ratelimit";

const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
const MAX_KEY_LENGTH = 128;

const apiKeyLimiter = rateLimit({
  max: 120,
  window: 60,
  keyPrefix: "api_key",
  keyFn: (c) => c.get("apiKeyId") ?? "",
});

/**
 * Accepts either `Authorization: Bearer enk_...` (API key) or the cookie
 * session. Anything that is not an `enk_` bearer goes through the unchanged
 * cookie flow; an `enk_` bearer is validated strictly and never falls back.
 *
 * Reusable: add `router.use("*", apiKeyOrCookieAuth)` to open a route group.
 */
export async function apiKeyOrCookieAuth(c: Context<HonoEnv>, next: Next) {
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearer?.startsWith(API_KEY_PREFIX)) {
    return authMiddleware(c, next);
  }

  const invalid = () => c.json({ error: "Invalid or expired API key" }, 401);
  if (bearer.length > MAX_KEY_LENGTH) return invalid();

  const hash = await sha256Hex(bearer);
  const record = await c.env.KV.get<ApiKeyRecord>(apiKeyKvKey(hash), "json");
  if (!record || Date.parse(record.expires_at) <= Date.now()) {
    return invalid();
  }

  c.set("apiKeyId", record.id);
  const limited = await apiKeyLimiter(c, async () => {});
  if (limited) return limited;

  // Disabled or deleted users lose their keys immediately.
  const user = await findUserById(
    c.env.DB,
    getTablePrefix(c.env),
    record.user_id,
  );
  if (!user?.is_active) return invalid();

  c.set("userId", user.id);
  c.set("role", user.role);

  c.executionCtx.waitUntil(touchLastUsed(c.env.KV, record, hash));

  await next();
}

/** Writes last_used_at to the index record at most once per throttle window. */
async function touchLastUsed(
  kv: KVNamespace,
  record: ApiKeyRecord,
  hash: string,
) {
  try {
    const idxKey = apiKeyIndexKey(record.user_id, record.id);
    const idx = await kv.get<ApiKeyIndexRecord>(idxKey, "json");
    if (!idx) return; // revoked in the meantime
    const last = idx.last_used_at ? Date.parse(idx.last_used_at) : 0;
    if (Date.now() - last < LAST_USED_THROTTLE_MS) return;
    await kv.put(
      idxKey,
      JSON.stringify({ ...idx, hash, last_used_at: new Date().toISOString() }),
      { expiration: Math.floor(Date.parse(idx.expires_at) / 1000) },
    );
  } catch (err) {
    console.error("Failed to update API key last_used_at:", err);
  }
}
