import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { PublicNavbar } from '../../components/PublicNavbar';
import { PublicFooter } from '../../components/PublicFooter';

export function HowItWorksPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F6F7FB]">
      <PublicNavbar />

      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-12">
        <div className="space-y-4 max-w-2xl">
          <div className="text-xs font-semibold text-[#635BFF] uppercase tracking-wider">
            How BookAm Works
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1A1B25] [text-wrap:balance]">
            Transparent local hiring from AI intake to verified deposit
          </h1>
          <p className="text-base text-[#6B7280] leading-relaxed">
            BookAm structures every request before workers bid, protects personal phone numbers until payment is verified, and keeps both parties informed at every step.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
            <Sparkles className="w-5 h-5 text-[#635BFF]" />
            <h2 className="text-lg font-bold text-[#1A1B25]">1. AI-assisted job intake</h2>
            <p className="text-sm text-[#6B7280] leading-relaxed">
              Describe your issue in plain language. BookAm extracts the category, location, urgency, and helpful follow-up questions, then shows an editable summary and provisional price range before you publish.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
            <CheckCircle2 className="w-5 h-5 text-[#00C853]" />
            <h2 className="text-lg font-bold text-[#1A1B25]">2. Competitive worker offers</h2>
            <p className="text-sm text-[#6B7280] leading-relaxed">
              Local professionals review your job on the board and submit a proposed price, estimated completion time, and availability. BookAm compares offers objectively without auto-picking for you.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
            <ShieldCheck className="w-5 h-5 text-[#FF6B35]" />
            <h2 className="text-lg font-bold text-[#1A1B25]">3. Atomic offer acceptance & Stripe Checkout</h2>
            <p className="text-sm text-[#6B7280] leading-relaxed">
              Accepting one offer creates a booking and closes competing pending offers in a single database transaction. You then pay the booking deposit through Stripe Checkout.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
            <Lock className="w-5 h-5 text-[#635BFF]" />
            <h2 className="text-lg font-bold text-[#1A1B25]">4. Webhook-verified contact unlock</h2>
            <p className="text-sm text-[#6B7280] leading-relaxed">
              Only after Stripe confirms payment via signed webhook does the backend unlock phone numbers for both customer and worker. Failed or cancelled payments keep contacts locked.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="text-lg font-bold text-[#1A1B25]">Ready to try BookAm?</h3>
            <p className="text-sm text-[#6B7280] mt-1">
              Create an account to post a job or browse open jobs in Benin City.
            </p>
          </div>
          <Link
            to="/signup"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold whitespace-nowrap"
          >
            Get Started
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
