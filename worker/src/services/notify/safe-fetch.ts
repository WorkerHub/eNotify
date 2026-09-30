export function isPrivateHostname(rawHost: string): boolean {
  const hostname = rawHost.toLowerCase().replace(/^\[|\]$/g, "");

  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal"))
    return true;

  if (hostname.includes(":")) {
    if (hostname === "::" || hostname === "::1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(hostname)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(hostname)) return true;
    const mapped = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateHostname(mapped[1]);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(hostname)) return true;
    return false;
  }

  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  // Numeric shorthand such as "2130706433" or "0x7f000001"
  if (/^(0x[0-9a-f]+|\d+)$/.test(hostname)) return true;

  return false;
}

export function validateOutboundUrl(
  raw: string,
  opts: { allowPrivate?: boolean } = {},
): { url?: URL; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: "Invalid URL" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { error: "Only HTTP(S) URLs are allowed" };
  }
  if (!opts.allowPrivate && isPrivateHostname(parsed.hostname)) {
    return { error: "URL must not point to private/internal addresses" };
  }
  return { url: parsed };
}

export async function safeErrorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.slice(0, 200);
}
