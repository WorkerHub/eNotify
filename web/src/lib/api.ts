const BASE_URL = "/api";

let refreshPromise: Promise<boolean> | null = null;

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const PUBLIC_AUTH_PATHS = [
  "/auth/login",
  "/auth/register",
  "/auth/password/",
  "/auth/email/",
  "/auth/2fa/verify",
  "/auth/2fa/otp/send",
  "/auth/2fa/passkey/authenticate/",
];

function isPublicAuthPath(path: string): boolean {
  return PUBLIC_AUTH_PATHS.some((p) => path.startsWith(p));
}

async function doRefresh(): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  return res.ok;
}

async function parseBody<T>(response: Response): Promise<T> {
  if (
    response.status === 204 ||
    response.headers.get("content-length") === "0"
  ) {
    return undefined as T;
  }
  return response.json();
}

/**
 * Performs the request and returns the raw `Response` (after the shared
 * session/refresh handling). Used for endpoints whose body is not JSON —
 * e.g. the export endpoints, which stream the download file itself.
 */
async function requestResponse(
  path: string,
  options: RequestInit & { skipRedirect?: boolean } = {},
): Promise<Response> {
  const { skipRedirect: skip, ...fetchOptions } = options;
  const skipRedirect = skip || isPublicAuthPath(path);
  const impersonateId = sessionStorage.getItem("impersonate_user_id");
  const headers: Record<string, string> = {
    ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}),
    ...(impersonateId ? { "X-Impersonate-User": impersonateId } : {}),
    ...((fetchOptions.headers as Record<string, string>) || {}),
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    ...fetchOptions,
    credentials: "include",
    headers,
  });

  if (response.status === 401 && isPublicAuthPath(path)) {
    const body = await response.json().catch(() => ({ error: "Unauthorized" }));
    throw new ApiError(401, body.error || "Unauthorized");
  }

  if (response.status === 401) {
    if (skipRedirect) {
      throw new ApiError(401, "Unauthorized");
    }

    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    const refreshed = await refreshPromise;

    if (refreshed) {
      const retryRes = await fetch(`${BASE_URL}${path}`, {
        ...fetchOptions,
        credentials: "include",
        headers,
      });
      if (retryRes.ok) return retryRes;
      if (retryRes.status === 401) {
        window.location.href = "/login";
        throw new ApiError(401, "Unauthorized");
      }
      const retryBody = await retryRes
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new ApiError(
        retryRes.status,
        retryBody.error || "Request failed",
        retryBody.code,
        retryBody.details,
      );
    }

    window.location.href = "/login";
    throw new ApiError(401, "Unauthorized");
  }

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new ApiError(
      response.status,
      body.error || "Request failed",
      body.code,
      body.details,
    );
  }

  return response;
}

async function request<T>(
  path: string,
  options: RequestInit & { skipRedirect?: boolean } = {},
): Promise<T> {
  return parseBody<T>(await requestResponse(path, options));
}

export const api = {
  get: <T>(path: string, opts?: { skipRedirect?: boolean }) =>
    request<T>(path, opts),
  post: <T>(path: string, data?: unknown, opts?: { skipRedirect?: boolean }) =>
    request<T>(path, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
      ...opts,
    }),
  /** POST returning the unparsed `Response` (file downloads, streams). */
  postRaw: (path: string, data?: unknown, opts?: { skipRedirect?: boolean }) =>
    requestResponse(path, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
      ...opts,
    }),
  put: <T>(path: string, data?: unknown, opts?: { skipRedirect?: boolean }) =>
    request<T>(path, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
      ...opts,
    }),
  delete: <T>(path: string, opts?: { skipRedirect?: boolean }) =>
    request<T>(path, { method: "DELETE", ...opts }),
};

// Public setup endpoints (no auth): use raw fetch because /api/setup requires the
// X-Setup-Secret header and its errors are status-coded (403 wrong secret, 429 rate
// limited), not the 401/session flow the generic `request` wrapper handles.
export interface SetupResult {
  success: boolean;
  alreadyInitialized?: boolean;
}

export const setupApi = {
  state: async (): Promise<{ enabled: boolean }> => {
    const res = await fetch(`${BASE_URL}/setup/state`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Setup state unavailable");
    return res.json();
  },
  run: async (secret: string): Promise<SetupResult> => {
    const res = await fetch(`${BASE_URL}/setup`, {
      method: "POST",
      headers: { "X-Setup-Secret": secret },
      credentials: "include",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, body.error || "Request failed");
    }
    return body as SetupResult;
  },
};

export { ApiError };
