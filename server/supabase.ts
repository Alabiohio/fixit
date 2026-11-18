import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';
import { getSupabaseAnonKey, getSupabaseServiceRoleKey, getSupabaseUrl } from './config.ts';

let cachedAdminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const serviceKey = getSupabaseServiceRoleKey();

  if (!url || !serviceKey) {
    return null;
  }

  if (!cachedAdminClient) {
    cachedAdminClient = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return cachedAdminClient;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey() && getSupabaseServiceRoleKey());
}

export interface AuthenticatedRequest extends Request {
  authUser?: User;
  supabaseAdmin?: SupabaseClient;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({
      error:
        'Supabase is not configured on the server. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.',
      code: 'SUPABASE_NOT_CONFIGURED',
    });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    return;
  }

  req.authUser = data.user;
  req.supabaseAdmin = admin;
  next();
}
