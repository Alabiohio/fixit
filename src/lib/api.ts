import { getSupabaseClient } from './supabase';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  requireAuth = true,
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  if (requireAuth) {
    const supabase = await getSupabaseClient();
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    if (!res.ok) {
      throw new ApiError(`Request failed with status ${res.status}`, res.status);
    }
    throw new Error(`Expected a JSON response from ${path} (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    const error =
      typeof payload === 'object' && payload !== null && 'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${res.status}`;
    const code =
      typeof payload === 'object' && payload !== null && 'code' in payload &&
      typeof payload.code === 'string'
        ? payload.code
        : undefined;
    throw new ApiError(
      error,
      res.status,
      code,
    );
  }

  return payload as T;
}
