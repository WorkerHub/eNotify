import { Hono } from "hono";
import { getTablePrefix } from "../types";
import type { Env } from "../types";
import { safeEqual } from "../core/auth";
import { rateLimit } from "../middleware/ratelimit";
import { runSetup } from "../lib/setup";

type HonoEnv = { Bindings: Env };

export const setupRoutes = new Hono<HonoEnv>();

// Public state endpoint: reports whether the setup page should be shown.
// Registered before the 405 catch-all below so it is not swallowed.
setupRoutes.get("/state", async (c) => {
  const prefix = getTablePrefix(c.env);
  const db = c.env.DB;

  try {
    const table = await db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .bind(`${prefix}system_settings`)
      .first();
    if (!table) return c.json({ enabled: true });

    const row = await db
      .prepare(`SELECT value FROM ${prefix}system_settings WHERE key = ?`)
      .bind("setup_page_enabled")
      .first<{ value: string }>();
    return c.json({ enabled: (row?.value ?? "1") !== "0" });
  } catch {
    // Uninitialized or unreadable: default to enabled.
    return c.json({ enabled: true });
  }
});

// GET /api/setup/* is deprecated for security: the secret must never appear in
// the URL (browser history, access logs, Referer, link previews). Use
// POST /api/setup with the X-Setup-Secret header instead.
setupRoutes.get("*", (c) => {
  c.header("Allow", "POST");
  return c.json(
    {
      error:
        "GET setup is deprecated. Use POST /api/setup with the X-Setup-Secret header.",
    },
    405,
  );
});

setupRoutes.post(
  "/",
  rateLimit({ max: 3, window: 600, keyPrefix: "setup" }),
  async (c) => {
    const secret = c.req.header("X-Setup-Secret");

    if (
      !c.env.SETUP_SECRET ||
      !(await safeEqual(secret ?? "", c.env.SETUP_SECRET))
    ) {
      return c.json({ error: "Invalid setup secret" }, 403);
    }

    const result = await runSetup(c.env);
    return c.json(result);
  },
);
