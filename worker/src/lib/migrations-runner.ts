import { getMigrations } from "./migrations";

/**
 * Ledger migration runner.
 *
 * The ledger table records which migrations have already been applied, so a
 * migration runs at most once per database and a failure is visible instead of
 * being swallowed. Table names are always resolved through `migrationsTable()`
 * — no other module may build the ledger name by hand.
 */

export type LedgerMigrationStatus = "applied" | "skipped";

export interface LedgerMigrationResult {
  name: string;
  status: LedgerMigrationStatus;
}

/**
 * Name of the migration ledger for a table prefix:
 * `_` + prefix core (trailing `_` stripped, case preserved) + `_schema_migrations`.
 * No prefix (or a bare `_`) yields the shared `_schema_migrations` name.
 */
export function migrationsTable(prefix: string): string {
  const core = prefix.replace(/_$/, "");
  if (core === "") return "_schema_migrations";
  return `_${core}_schema_migrations`;
}

/** Create the ledger table if it does not exist yet; returns its name. */
export async function ensureLedgerTable(
  db: D1Database,
  prefix: string,
): Promise<string> {
  const ledger = migrationsTable(prefix);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${ledger} (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))`,
    )
    .run();
  return ledger;
}

/** Record `name` as applied in the ledger. */
export async function recordMigration(
  db: D1Database,
  prefix: string,
  name: string,
): Promise<void> {
  const ledger = migrationsTable(prefix);
  await db.prepare(`INSERT INTO ${ledger} (name) VALUES (?)`).bind(name).run();
}

/** Split a migration into single statements, matching the pre-ledger install path. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function migrationError(name: string, err: unknown): Error {
  const reason = err instanceof Error ? err.message : String(err);
  return new Error(`Migration "${name}" failed: ${reason}`, { cause: err });
}

/**
 * Apply every not-yet-recorded migration in `getMigrations(prefix)` order.
 *
 * A migration's statements are all executed first and only then recorded, so a
 * partially applied migration is retried on the next run (every statement is
 * guarded by `IF NOT EXISTS` / probes). Any failure throws immediately, naming
 * the migration and the original error; the failing migration is not recorded
 * and later migrations are not executed.
 */
export async function runLedgerMigrations(
  db: D1Database,
  prefix: string,
): Promise<LedgerMigrationResult[]> {
  const ledger = await ensureLedgerTable(db, prefix);

  const recorded = await db
    .prepare(`SELECT name FROM ${ledger}`)
    .all<{ name: string }>();
  const applied = new Set(recorded.results.map((r) => r.name));

  const results: LedgerMigrationResult[] = [];
  for (const migration of getMigrations(prefix)) {
    if (applied.has(migration.name)) {
      results.push({ name: migration.name, status: "skipped" });
      continue;
    }
    try {
      for (const statement of splitStatements(migration.sql)) {
        await db.prepare(statement).run();
      }
      await recordMigration(db, prefix, migration.name);
    } catch (err) {
      throw migrationError(migration.name, err);
    }
    results.push({ name: migration.name, status: "applied" });
  }

  return results;
}
