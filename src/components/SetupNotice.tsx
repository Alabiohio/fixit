import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function SetupNotice() {
  const { config } = useAuth();
  if (!config) return null;

  const missing: string[] = [];
  if (!config.configuredServices.supabase) {
    missing.push('Supabase (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)');
  }
  if (!config.configuredServices.groq) {
    missing.push('Groq AI (GROQ_API_KEY, GROQ_MODEL)');
  }
  if (!config.configuredServices.stripe || !config.configuredServices.stripeWebhook) {
    missing.push('Stripe Test Payments (STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET)');
  }

  if (missing.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-[#FF6B35]/40 p-5 shadow-xs">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-[#FF6B35] shrink-0 mt-0.5" />
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[#1A1B25]">
            External environment configuration required
          </h3>
          <p className="text-xs text-[#6B7280] leading-relaxed">
            FixIt uses real Supabase PostgreSQL/Auth, Groq AI, and Stripe Checkout webhooks. Configure the following environment variables in your <code className="font-mono text-[#1A1B25]">.env</code> file to enable live operations:
          </p>
          <ul className="text-xs text-[#1A1B25] space-y-1 list-disc list-inside">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
