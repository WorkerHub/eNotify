import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Migration } from "../src/lib/migrations";
import { runSetup } from "../src/lib/setup";
import type { Env } from "../src/types";
import { SqliteD1 } from "./support/sqlite-d1";

/**
 * Failure visibility (spec §5.7): a failing migration must abort setup with an
 * error naming the migration, must not be recorded, and must not run the
 * migrations after it. Once fixed, the next setup continues from the ledger.
 *
 * The migration list is injected here — a migration cannot realistically fail
 * on a healthy database, so the list is the test seam.
 */

const state = vi.hoisted(() => ({
  migrations: [] as Migration[],
}));

vi.mock("../src/lib/migrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/migrations")>();
  return {
    ...actual,
    getMigrations: (prefix: string): Migration[] =>
      state.migrations.map((migration) => ({
        name: migration.name,
        sql: migration.sql.replace(/\{prefix\}/g, prefix),
      })),
  };
});

function makeEnv(d1: SqliteD1): Env {
  return { DB: d1, TABLE_PREFIX: "" } as unknown as Env;
}

function tableNames(d1: SqliteD1): string[] {
  return (
    d1.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function ledgerNames(d1: SqliteD1): string[] {
  return (
    d1.db
      .prepare(`SELECT name FROM _schema_migrations ORDER BY rowid`)
      .all() as { name: string }[]
  ).map((r) => r.name);
}

const V1: Migration = {
  name: "schema_v1",
  sql: "CREATE TABLE IF NOT EXISTS {prefix}users (id TEXT PRIMARY KEY, email TEXT NOT NULL)",
};

const V2_BROKEN: Migration = {
  name: "schema_v2_broken",
  sql: "CREATE TABLE IF NOT EXISTS {prefix}experimental (id TEXT); SELECT * FROM {prefix}table_that_does_not_exist",
};

const V3: Migration = {
  name: "schema_v3",
  sql: "CREATE TABLE IF NOT EXISTS {prefix}after_failure (id TEXT)",
};

beforeEach(() => {
  state.migrations = [];
});

describe("failing migration", () => {
  it("aborts setup with the migration name, records nothing and runs no later migration", async () => {
    const d1 = new SqliteD1();
    state.migrations = [V1, V2_BROKEN, V3];

    await expect(runSetup(makeEnv(d1))).rejects.toThrow(
      /Migration "schema_v2_broken" failed: .*table_that_does_not_exist/,
    );

    // The earlier migration stays recorded; the failing one and everything
    // after it do not.
    expect(ledgerNames(d1)).toEqual(["schema_v1"]);
    expect(tableNames(d1)).not.toContain("after_failure");
  });

  it("continues from the ledger once the migration is fixed", async () => {
    const d1 = new SqliteD1();
    state.migrations = [V1, V2_BROKEN, V3];
    await expect(runSetup(makeEnv(d1))).rejects.toThrow(/schema_v2_broken/);

    // Same name, fixed SQL — a broken migration is corrected in place only
    // while no database has recorded it.
    state.migrations = [
      V1,
      {
        ...V2_BROKEN,
        sql: "CREATE TABLE IF NOT EXISTS {prefix}experimental (id TEXT)",
      },
      V3,
    ];

    const result = await runSetup(makeEnv(d1));

    expect(result).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "",
      migrations: [
        { name: "schema_v1", status: "skipped" },
        { name: "schema_v2_broken", status: "applied" },
        { name: "schema_v3", status: "applied" },
      ],
    });
    expect(ledgerNames(d1)).toEqual([
      "schema_v1",
      "schema_v2_broken",
      "schema_v3",
    ]);
    expect(tableNames(d1)).toContain("experimental");
    expect(tableNames(d1)).toContain("after_failure");
  });

  it("does not swallow a failure on the fresh-install path either", async () => {
    const d1 = new SqliteD1();
    state.migrations = [V2_BROKEN];

    await expect(runSetup(makeEnv(d1))).rejects.toThrow(/schema_v2_broken/);
    expect(ledgerNames(d1)).toEqual([]);
  });
});
