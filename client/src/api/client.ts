/**
 * Baxnaano Centralized HTTP API Client
 * - Enforces a strict 10-second default timeout (AbortController) on all requests
 *   so cold starts or network drops never cause an endless loading spinner.
 * - Supports fast lightweight /health keep-alive and wake-up pings.
 * - Injects JWT Authorization and branch scope headers.
 */

export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.location.port !== '5173'
    ? `${window.location.origin}/api`
    : 'http://localhost:4000/api');

export const API_BASE_URL = API_BASE;

export const SERVER_ROOT_URL = API_BASE.replace(/\/api\/?$/, '');

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

let inMemoryAccessToken: string | null =
  typeof sessionStorage !== 'undefined'
    ? sessionStorage.getItem('baxnaano_session_token')
    : null;

export function setApiAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
  if (typeof sessionStorage !== 'undefined') {
    try {
      if (token) {
        sessionStorage.setItem('baxnaano_session_token', token);
      } else {
        sessionStorage.removeItem('baxnaano_session_token');
      }
    } catch {
      // ignore storage errors
    }
  }
}

export function getApiAccessToken(): string | null {
  return inMemoryAccessToken;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  messageKey?: string;
  details?: unknown;
  isTimeout?: boolean;

  constructor(
    status: number,
    message: string,
    code?: string,
    messageKey?: string,
    details?: unknown,
    isTimeout: boolean = false
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.messageKey = messageKey;
    this.details = details;
    this.isTimeout = isTimeout;
  }
}

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Wrapper around fetch() that enforces a strict 10-second timeout by default.
 */
export async function fetchWithTimeout(
  url: string,
  options: ApiRequestOptions = {},
  timeoutMs: number = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = options.signal;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ApiError(
        408,
        `Request timed out after ${Math.round(timeoutMs / 1000)} seconds. The server may be waking up from sleep — please click Retry.`,
        'REQUEST_TIMEOUT',
        'common.errors.request_timeout',
        undefined,
        true
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

/**
 * Lightweight zero-DB health check to wake or verify the Render container quickly.
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `${SERVER_ROOT_URL}/health`,
      {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      },
      5000
    );
    if (res.ok) return true;
  } catch {
    // fallback to /api/health
  }

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/health`,
      {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      },
      5000
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const token = inMemoryAccessToken;
  const activeBranchId =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('baxnaano_active_branch')
      : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (activeBranchId) {
    headers['x-branch-id'] = activeBranchId;
  }

  const url = endpoint.startsWith('http')
    ? endpoint
    : `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        ...options,
        credentials: 'include',
        headers,
      },
      options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    );
  } catch (err: any) {
    if (err instanceof ApiError) {
      throw err;
    }
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    throw new ApiError(
      0,
      isOffline
        ? 'Internet connection is unavailable. Please check your network and click Retry.'
        : 'Cannot connect to Baxnaano server (server may be waking up). Please click Retry.',
      isOffline ? 'OFFLINE' : 'SERVER_UNREACHABLE',
      isOffline ? 'common.errors.network_offline' : 'common.errors.server_unreachable'
    );
  }

  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('baxnaano:auth-unauthorized'));
    }
  }

  if (!response.ok) {
    let errBody: { error?: string; messageKey?: string; message?: string; details?: unknown } = {};
    try {
      errBody = await response.json();
    } catch {
      // response wasn't JSON
    }

    const errorMessage =
      errBody.message ||
      errBody.error ||
      `Server returned ${response.status}: ${response.statusText}`;

    throw new ApiError(
      response.status,
      errorMessage,
      errBody.error,
      errBody.messageKey,
      errBody.details
    );
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(endpoint: string, options?: ApiRequestOptions) =>
    apiRequest<T>(endpoint, { method: 'GET', ...options }),
  post: <T>(endpoint: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(endpoint, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),
  patch: <T>(endpoint: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(endpoint, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),
  delete: <T>(endpoint: string, options?: ApiRequestOptions) =>
    apiRequest<T>(endpoint, { method: 'DELETE', ...options }),
};
