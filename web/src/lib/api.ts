const BASE_URL = '/api'

let refreshPromise: Promise<boolean> | null = null

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function doRefresh(): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
  return res.ok
}

async function request<T>(path: string, options: RequestInit & { skipRedirect?: boolean } = {}): Promise<T> {
  const { skipRedirect, ...fetchOptions } = options
  const impersonateId = sessionStorage.getItem('impersonate_user_id')
  const headers: Record<string, string> = {
    ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}),
    ...(impersonateId ? { 'X-Impersonate-User': impersonateId } : {}),
    ...(fetchOptions.headers as Record<string, string> || {}),
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...fetchOptions,
    credentials: 'include',
    headers,
  })

  if (response.status === 401) {
    if (skipRedirect) {
      throw new ApiError(401, 'Unauthorized')
    }

    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => { refreshPromise = null })
    }
    const refreshed = await refreshPromise

    if (refreshed) {
      const retryRes = await fetch(`${BASE_URL}${path}`, {
        ...fetchOptions,
        credentials: 'include',
        headers,
      })
      if (retryRes.ok) return retryRes.json()
      if (retryRes.status === 401) {
        window.location.href = '/login'
        throw new ApiError(401, 'Unauthorized')
      }
      const retryBody = await retryRes.json().catch(() => ({ error: 'Unknown error' }))
      throw new ApiError(retryRes.status, retryBody.error || 'Request failed')
    }

    window.location.href = '/login'
    throw new ApiError(401, 'Unauthorized')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new ApiError(response.status, body.error || 'Request failed')
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T
  }

  return response.json()
}

export const api = {
  get: <T>(path: string, opts?: { skipRedirect?: boolean }) => request<T>(path, opts),
  post: <T>(path: string, data?: unknown, opts?: { skipRedirect?: boolean }) => request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined, ...opts }),
  put: <T>(path: string, data?: unknown) => request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export { ApiError }
