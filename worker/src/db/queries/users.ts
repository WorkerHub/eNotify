import type { User } from '../../types';

export async function createUser(
  db: D1Database,
  prefix: string,
  data: { id: string; email: string; password_hash: string; role: string }
): Promise<void> {
  const table = `${prefix}users`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO ${table} (id, email, password_hash, role, is_active, email_verified, base_currency, timezone, language, theme, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, 'CNY', 'UTC', 'zh', 'system', ?, ?)`
    )
    .bind(data.id, data.email, data.password_hash, data.role, now, now)
    .run();
}

export async function findUserByEmail(
  db: D1Database,
  prefix: string,
  email: string
): Promise<User | null> {
  const table = `${prefix}users`;
  return db
    .prepare(`SELECT * FROM ${table} WHERE email = ?`)
    .bind(email)
    .first<User>();
}

export async function findUserById(
  db: D1Database,
  prefix: string,
  id: string
): Promise<User | null> {
  const table = `${prefix}users`;
  return db
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<User>();
}

export async function updateUser(
  db: D1Database,
  prefix: string,
  id: string,
  data: Partial<Pick<User, 'email' | 'password_hash' | 'is_active' | 'email_verified' | 'base_currency' | 'timezone' | 'language' | 'theme' | 'role'>>
): Promise<void> {
  const table = `${prefix}users`;
  const now = new Date().toISOString();
  const allowedCols = new Set(['email', 'password_hash', 'is_active', 'email_verified', 'base_currency', 'timezone', 'language', 'theme', 'role']);
  const entries = (Object.entries(data) as [string, unknown][]).filter(([col]) => allowedCols.has(col));
  if (entries.length === 0) return;

  const setClauses = entries.map(([col]) => `${col} = ?`).join(', ');
  const values = entries.map(([, val]) => val);

  await db
    .prepare(`UPDATE ${table} SET ${setClauses}, updated_at = ? WHERE id = ?`)
    .bind(...values, now, id)
    .run();
}

export async function deleteUser(
  db: D1Database,
  prefix: string,
  id: string
): Promise<void> {
  const table = `${prefix}users`;
  await db
    .prepare(`DELETE FROM ${table} WHERE id = ?`)
    .bind(id)
    .run();
}

export async function listUsers(
  db: D1Database,
  prefix: string
): Promise<User[]> {
  const table = `${prefix}users`;
  const result = await db
    .prepare(`SELECT * FROM ${table} ORDER BY created_at DESC`)
    .all<User>();
  return result.results;
}

export async function listActiveUsersForScheduler(
  db: D1Database,
  prefix: string
): Promise<Pick<User, 'id' | 'timezone' | 'language' | 'is_active'>[]> {
  const table = `${prefix}users`;
  const result = await db
    .prepare(`SELECT id, timezone, language, is_active FROM ${table} WHERE is_active = 1`)
    .all<Pick<User, 'id' | 'timezone' | 'language' | 'is_active'>>();
  return result.results;
}

export async function countUsers(
  db: D1Database,
  prefix: string
): Promise<number> {
  const table = `${prefix}users`;
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM ${table}`)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
