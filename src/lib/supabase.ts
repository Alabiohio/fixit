import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../types/FixIt';

let supabaseInstance: SupabaseClient | null = null;
let cachedConfig: AppConfig | null = null;

export async function loadAppConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig;
  const res = await fetch('/api/config');
  if (!res.ok) {
    throw new Error('Failed to load application configuration');
  }
  const data = (await res.json()) as AppConfig;
  cachedConfig = data;
  return data;
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (supabaseInstance) return supabaseInstance;

  const cfg = await loadAppConfig();
  const url = cfg.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || '';
  const anonKey = cfg.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  if (!url || !anonKey) {
    return null;
  }

  supabaseInstance = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return supabaseInstance;
}
