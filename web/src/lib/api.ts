const BASE_URL = "/api";

let refreshPromise: Promise<boolean> | null = null;

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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

async function request<T>(
  path: string,
  options: RequestInit & { skipRedirect?: boolean } = {},
): Promise<T> {
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
      if (retryRes.ok) return parseBody<T>(retryRes);
      if (retryRes.status === 401) {
        window.location.href = "/login";
        throw new ApiError(401, "Unauthorized");
      }
      const retryBody = await retryRes
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new ApiError(retryRes.status, retryBody.error || "Request failed");
    }

    window.location.href = "/login";
    throw new ApiError(401, "Unauthorized");
  }

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new ApiError(response.status, body.error || "Request failed");
  }

  return parseBody<T>(response);
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
  put: <T>(path: string, data?: unknown, opts?: { skipRedirect?: boolean }) =>
    request<T>(path, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
      ...opts,
    }),
  delete: <T>(path: string, opts?: { skipRedirect?: boolean }) =>
    request<T>(path, { method: "DELETE", ...opts }),
};

export { ApiError };
