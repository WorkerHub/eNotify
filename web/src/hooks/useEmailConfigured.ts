import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Subset of `GET /api/system/info` (public, unauthenticated) used here. */
interface SystemInfo {
  email_configured?: boolean;
}

export interface EmailConfiguredState {
  /**
   * Whether the site can send email. Fail-closed: while unknown, or when the
   * lookup fails, this is `false` — never expose an email entry point that
   * cannot work (spec ONE-461 §3.1 / §3.8).
   */
  configured: boolean;
  loading: boolean;
}

/**
 * Reads `email_configured` from `GET /api/system/info` on mount — the same
 * public endpoint the login page already uses for `registration_enabled`.
 */
export function useEmailConfigured(): EmailConfiguredState {
  const [state, setState] = useState<EmailConfiguredState>({
    configured: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    api
      .get<SystemInfo>("/system/info")
      .then((info) => {
        if (cancelled) return;
        setState({
          configured: info.email_configured === true,
          loading: false,
        });
      })
      .catch(() => {
        // Fail-closed: a failed lookup must not surface email entry points.
        if (cancelled) return;
        setState({ configured: false, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
