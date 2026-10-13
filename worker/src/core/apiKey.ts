export const API_KEY_PREFIX = "enk_";
export const MAX_API_KEYS_PER_USER = 20;
export const DEFAULT_API_KEY_DAYS = 365;
export const MAX_API_KEY_DAYS = 3650;

/** Reserved for future fine-grained permissions; "*" = same as the user's session. */
export const API_KEY_SCOPES_ALL = ["*"];

// api_key:<sha256>        -> ApiKeyRecord (used for authentication, never mutated)
// api_key_idx:<uid>:<id>  -> ApiKeyIndexRecord (used for list / revoke / last_used_at)
export const apiKeyKvKey = (hash: string) => `api_key:${hash}`;
export const apiKeyIndexPrefix = (userId: string) => `api_key_idx:${userId}:`;
export const apiKeyIndexKey = (userId: string, id: string) =>
  `${apiKeyIndexPrefix(userId)}${id}`;

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  expires_at: string;
  scopes: string[];
}

export interface ApiKeyIndexRecord {
  id: string;
  hash: string;
  name: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  scopes: string[];
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${API_KEY_PREFIX}${b64}`;
}
