/**
 * Baxnaano Centralized Online-Only HTTP API Client
 * - Authoritative direct communication with Express + PostgreSQL backend.
 * - In-memory access token storage (never persisted to localStorage).
 * - HttpOnly cookies with credentials: 'include'.
 * - Injects JWT Authorization and branch scope headers.
 * - Handles connection health checks, network timeouts, and structured error propagation.
 */

export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.location.port !== '5173'
    ? `${window.location.origin}/api`
    : 'http://localhost:4000/api');

export const API_BASE_URL = API_BASE;

let inMemoryAccessToken: string | null = null;

export function setApiAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

export function getApiAccessToken(): string | null {
  return inMemoryAccessToken;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  messageKey?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, messageKey?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.messageKey = messageKey;
    this.details = details;
  }
}

export async function checkServerHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`${API_BASE}/health`, {
      method: 'GET',
      credentials: 'include',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = inMemoryAccessToken;
  const activeBranchId = typeof localStorage !== 'undefined' ? localStorage.getItem('baxnaano_active_branch') : null;

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
    response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers,
    });
  } catch {
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    throw new ApiError(
      0,
      isOffline
        ? 'Internet connection is unavailable. Please check your network and reconnect.'
        : 'Cannot connect to Baxnaano server. Please check your connection or contact administrator.',
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

  // Handle empty bodies (204 No Content)
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(endpoint: string, options?: RequestInit) =>
    apiRequest<T>(endpoint, { method: 'GET', ...options }),
  post: <T>(endpoint: string, body?: unknown, options?: RequestInit) =>
    apiRequest<T>(endpoint, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),
  patch: <T>(endpoint: string, body?: unknown, options?: RequestInit) =>
    apiRequest<T>(endpoint, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),
  delete: <T>(endpoint: string, options?: RequestInit) =>
    apiRequest<T>(endpoint, { method: 'DELETE', ...options }),
};
