import { Hono } from "hono";
import { adminRoutes } from "../src/routes/admin";
import { setupRoutes } from "../src/routes/setup";
import { signJWT } from "../src/core/auth";

export const TEST_JWT_SECRET = "test-jwt-secret-0123456789abcdef";
export const TEST_SETUP_SECRET = "test-setup-secret";

export type TestEnv = Record<string, unknown>;

export function makeEnv(overrides: TestEnv = {}): TestEnv {
  return {
    DB: new MockD1(),
    KV: new MockKV(),
    JWT_SECRET: TEST_JWT_SECRET,
    SETUP_SECRET: TEST_SETUP_SECRET,
    TABLE_PREFIX: "",
    ASSETS: {},
    ...overrides,
  };
}

export function makeApp(): Hono {
  const app = new Hono();
  app.route("/api/setup", setupRoutes);
  app.route("/api/admin", adminRoutes);
  return app;
}

export async function request(
  app: Hono,
  env: TestEnv,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: any }> {
  const res = await app.request(path, init, env);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

// ─── KV mock ──────────────────────────────────────────────────────────────────

export class MockKV {
  store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ─── D1 mock ──────────────────────────────────────────────────────────────────
//
// A minimal in-memory stand-in for the D1 operations used by the setup and
// system-settings code paths. It models table existence, columns, and the
// system_settings key/value rows — nothing more.

type Column = { name: string };

export class MockD1 {
  tables = new Map<string, string[]>();
  settings = new Map<string, string>();

  constructor(init?: {
    tables?: Record<string, string[]>;
    settings?: Record<string, string>;
  }) {
    if (init?.tables) {
      for (const [name, cols] of Object.entries(init.tables)) {
        this.tables.set(name, [...cols]);
      }
    }
    if (init?.settings) {
      for (const [k, v] of Object.entries(init.settings)) {
        this.settings.set(k, v);
      }
    }
  }

  prepare(sql: string): MockStatement {
    return new MockStatement(this, sql);
  }

  async exec(
    sql: string,
    args: unknown[],
    mode: "first" | "all" | "run",
  ): Promise<unknown> {
    const s = sql.trim();

    if (s.includes("sqlite_master")) {
      // Full-table scan (no "name=?" filter) enumerates every table, as the
      // prefix-detection query in runSetup does.
      if (!/name\s*=\s*\?/.test(s)) {
        const rows = [...this.tables.keys()].map((name) => ({ name }));
        if (mode === "first") return rows[0] ?? null;
        return rows;
      }
      const name = String(args[0] ?? "");
      const exists = this.tables.has(name);
      if (mode === "first") return exists ? { name } : null;
      return exists ? [{ name }] : [];
    }

    const pragma = s.match(/PRAGMA table_info\((\w+)\)/i);
    if (pragma) {
      const rows: Column[] = (this.tables.get(pragma[1]) ?? []).map((name) => ({
        name,
      }));
      if (mode === "first") return rows[0] ?? null;
      return rows;
    }

    const create = s.match(
      /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*)\)/i,
    );
    if (create) {
      this.tables.set(create[1], parseColumns(create[2]));
      return null;
    }

    if (/^CREATE (UNIQUE )?INDEX/i.test(s)) return null;

    const addCol = s.match(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/i);
    if (addCol) {
      const cols = this.tables.get(addCol[1]) ?? [];
      cols.push(addCol[2]);
      this.tables.set(addCol[1], cols);
      return null;
    }

    const dropCol = s.match(/ALTER TABLE\s+(\w+)\s+DROP COLUMN\s+(\w+)/i);
    if (dropCol) {
      this.tables.set(
        dropCol[1],
        (this.tables.get(dropCol[1]) ?? []).filter((c) => c !== dropCol[2]),
      );
      return null;
    }

    if (/^INSERT/i.test(s) && s.includes("key")) {
      this.settings.set(String(args[0] ?? ""), String(args[1] ?? ""));
      return null;
    }

    const selectValue = s.match(
      /SELECT value FROM\s+(\w+)\s+WHERE\s+key\s*=\s*\?/i,
    );
    if (selectValue) {
      const key = String(args[0] ?? "");
      if (mode === "first") {
        return this.settings.has(key)
          ? { value: this.settings.get(key) }
          : null;
      }
      return this.settings.has(key) ? [{ value: this.settings.get(key) }] : [];
    }

    const selectAll = s.match(/SELECT key,\s*value FROM\s+(\w+)/i);
    if (selectAll) {
      const rows = [...this.settings.entries()].map(([key, value]) => ({
        key,
        value,
      }));
      if (mode === "first") return rows[0] ?? null;
      return rows;
    }

    if (/^UPDATE/i.test(s)) return null;

    if (mode === "all") return [];
    return null;
  }
}

function parseColumns(body: string): string[] {
  const cols: string[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) {
      continue;
    }
    const name = line.split(/\s+/)[0];
    if (name && /^\w+$/.test(name)) cols.push(name);
  }
  return cols;
}

class MockStatement {
  private args: unknown[] = [];

  constructor(
    private db: MockD1,
    private sql: string,
  ) {}

  bind(...args: unknown[]): this {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return (await this.db.exec(this.sql, this.args, "first")) as T | null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const results = (await this.db.exec(this.sql, this.args, "all")) as T[];
    return { results };
  }

  async run(): Promise<{ success: true }> {
    await this.db.exec(this.sql, this.args, "run");
    return { success: true };
  }
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export async function makeToken(
  role: "admin" | "user",
  opts: { sub?: string; sid?: string } = {},
): Promise<string> {
  const sub = opts.sub ?? "user-1";
  const sid = opts.sid ?? "session-1";
  const now = Math.floor(Date.now() / 1000);
  return signJWT(
    {
      sub,
      role,
      jti: "jti-1",
      sid,
      exp: now + 3600,
      iat: now,
    },
    TEST_JWT_SECRET,
  );
}

export async function seedSession(
  env: TestEnv,
  sub: string,
  sid = "session-1",
): Promise<void> {
  const kv = env.KV as MockKV;
  kv.store.set(`ss:${sid}`, sub);
}

export function cookieHeader(token: string): Record<string, string> {
  return { Cookie: `access_token=${token}` };
}

export function ipHeader(ip: string): Record<string, string> {
  return { "cf-connecting-ip": ip };
}
