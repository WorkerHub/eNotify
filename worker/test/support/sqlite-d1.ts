/**
 * Minimal D1 stand-in backed by a real in-memory SQLite database
 * (`node:sqlite`, built into Node 22+).
 *
 * Unlike the `MockD1` in helpers.ts this keeps real column defaults, row data,
 * foreign keys, PRAGMA output and `meta.changes`, which is what
 * schema/migration/claim assertions need to stay honest. D1 is SQLite, so the
 * SQL under test runs unchanged.
 */
// @ts-expect-error node:sqlite ships with Node but is not in the Workers type set.
import { DatabaseSync } from "node:sqlite";

export class SqliteD1 {
  readonly db = new DatabaseSync(":memory:");

  prepare(sql: string): any {
    const db = this.db;
    const statement = () => db.prepare(sql);

    return {
      bind: (...args: unknown[]) => ({
        first: async <T>() =>
          (statement().get(...(args as any[])) ?? null) as T | null,
        all: async <T>() => ({
          results: statement().all(...(args as any[])) as T[],
        }),
        run: async () => {
          const result = statement().run(...(args as any[]));
          return {
            success: true,
            meta: {
              changes: Number(result.changes),
              last_row_id: Number(result.lastInsertRowid),
            },
          };
        },
      }),
      first: async <T>() => (statement().get() ?? null) as T | null,
      all: async <T>() => ({ results: statement().all() as T[] }),
      run: async () => {
        const result = statement().run();
        return {
          success: true,
          meta: {
            changes: Number(result.changes),
            last_row_id: Number(result.lastInsertRowid),
          },
        };
      },
    };
  }
}
