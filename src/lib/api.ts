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

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      payload?.error || `Request failed with status ${res.status}`,
      res.status,
      payload?.code,
    );
  }

  return payload as T;
}
