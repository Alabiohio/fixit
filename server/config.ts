export interface PublicAppConfig {
  appUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  stripePublishableKey: string;
  defaultCurrency: string;
  defaultDeposit: number;
  configuredServices: {
    supabase: boolean;
    groq: boolean;
    stripe: boolean;
    stripeWebhook: boolean;
  };
}

export function getAppUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

export function getSupabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  ).trim();
}

export function getSupabaseAnonKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
}

export function getSupabaseServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

export function getGroqApiKey(): string {
  return (process.env.GROQ_API_KEY || '').trim();
}

export function getGroqModel(): string {
  const configured = (process.env.GROQ_MODEL || '').trim();
  return configured || 'openai/gpt-oss-120b';
}

export function getStripeSecretKey(): string {
  return (process.env.STRIPE_SECRET_KEY || '').trim();
}

export function getStripePublishableKey(): string {
  return (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    process.env.VITE_STRIPE_PUBLISHABLE_KEY ||
    ''
  ).trim();
}

export function getStripeWebhookSecret(): string {
  return (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
}

export function getDefaultCurrency(): string {
  return (process.env.FixIt_DEFAULT_CURRENCY || 'ngn').trim().toLowerCase();
}

export function getDefaultDeposit(): number {
  const parsed = Number(process.env.FixIt_DEFAULT_DEPOSIT || '2000');
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 2000;
}

export function getFallbackCurrency(): string {
  return (process.env.FixIt_STRIPE_FALLBACK_CURRENCY || 'usd').trim().toLowerCase();
}

export function getNgnPerUsdRate(): number {
  const parsed = Number(process.env.FixIt_NGN_PER_USD_TEST_RATE || '1600');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1600;
}

export function getPublicAppConfig(): PublicAppConfig {
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  return {
    appUrl: getAppUrl(),
    supabaseUrl,
    supabaseAnonKey,
    stripePublishableKey: getStripePublishableKey(),
    defaultCurrency: getDefaultCurrency(),
    defaultDeposit: getDefaultDeposit(),
    configuredServices: {
      supabase: Boolean(supabaseUrl && supabaseAnonKey && serviceRoleKey),
      groq: Boolean(getGroqApiKey()),
      stripe: Boolean(getStripeSecretKey()),
      stripeWebhook: Boolean(getStripeWebhookSecret()),
    },
  };
}
