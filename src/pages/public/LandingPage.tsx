import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Lock,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { PublicNavbar } from '../../components/PublicNavbar';
import { PublicFooter } from '../../components/PublicFooter';
import { SERVICE_CATEGORIES, SUPPORTED_CITIES } from '../../../shared/constants';
import { apiRequest } from '../../lib/api';
import type {
  PriceEstimateResult,
  UnderstandJobResult,
  ValidateJobResult,
} from '../../types/FixIt';

const FAQS = [
  {
    q: 'How does FixIt protect my phone number?',
    a: 'Your phone number is never shown on the public job board or in initial offer listings. Contact information is unlocked only after an offer is accepted and the booking deposit payment is verified via Stripe webhook.',
  },
  {
    q: 'Are AI price estimates guaranteed final quotes?',
    a: 'No. FixIt Intelligence provides provisional indicative ranges based on editable local pricing baselines. Skilled workers submit their own offers after reviewing your job details, and you can also enter your own budget.',
  },
  {
    q: 'Where does FixIt currently operate?',
    a: 'Our initial marketplace focus is Benin City, Edo State (including Ugbowo, GRA, Ring Road, Sapele Road, Uselu, Adesuwa, and Ekosodin). The platform is structured to support additional cities and categories.',
  },
  {
    q: 'Can I be both a customer and a worker with one account?',
    a: 'Yes. Every FixIt account supports both customer and worker workflows. You can post jobs for your home and also create a Worker Profile to browse open jobs and submit offers.',
  },
  {
    q: 'What happens if a deposit payment fails or is cancelled?',
    a: 'Failed or abandoned payments never unlock contact details. Your booking stays pending payment so you can safely retry Checkout whenever you are ready.',
  },
];

export function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [demoInput, setDemoInput] = useState(
    'I need a plumber in Ugbowo. My kitchen pipe is leaking badly and I need someone tomorrow.',
  );
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoResult, setDemoResult] = useState<{
    validation: ValidateJobResult;
    understood: UnderstandJobResult | null;
    estimate: PriceEstimateResult | null;
  } | null>(null);
  const [demoError, setDemoError] = useState('');

  async function handleAnalyzePreview(e: React.FormEvent) {
    e.preventDefault();
    setDemoLoading(true);
    setDemoError('');
    try {
      const data = await apiRequest<{
        validation: ValidateJobResult;
        understood: UnderstandJobResult | null;
        estimate: PriceEstimateResult | null;
      }>(
        '/api/ai/analyze-request',
        {
          method: 'POST',
          body: JSON.stringify({ description: demoInput }),
        },
        false,
      );
      setDemoResult(data);
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : 'Unable to analyze request right now.');
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F7FB] text-[#1A1B25]">
      <PublicNavbar />

      {/* HERO SECTION */}
      <section className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <div className="text-xs font-medium text-[#6B7280] tracking-wide">
                Benin City, Edo State · Local Services Marketplace
              </div>

              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-[#1A1B25] leading-[1.12] [text-wrap:balance]">
                Find trusted local services without the guesswork.
              </h1>

              <p className="text-base sm:text-lg text-[#6B7280] leading-relaxed max-w-xl">
                Describe what you need, compare offers from skilled professionals and book with confidence.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <Link
                  to="/signup"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  Find a Professional
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/signup?role=worker"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-slate-300 bg-white hover:bg-[#F6F7FB] text-[#1A1B25] text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  Become a Worker
                </Link>
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[#6B7280]">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-[#00C853]" />
                  AI request structuring
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-[#635BFF]" />
                  Contact protection until deposit
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#FF6B35]" />
                  Stripe-verified checkout
                </span>
              </div>
            </div>

            {/* Realistic Marketplace Preview + Benin City Artisan Image */}
            <div className="lg:col-span-6 space-y-4">
              <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
                <div className="aspect-[16/9] bg-slate-100 relative overflow-hidden">
                  <img
                    src="/src/assets/images/hero_benin_artisan_1795040955113.jpg"
                    alt="Skilled technician inspecting a modern kitchen sink fixture in Benin City"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#1A1B25]/75 via-[#1A1B25]/20 to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4 text-white">
                    <div className="text-xs text-white/80">
                      Sample workflow preview · Ugbowo, Benin City
                    </div>
                    <div className="text-base font-semibold mt-0.5">
                      Kitchen pipe repair · Plumbing
                    </div>
                  </div>
                </div>

                <div className="p-5 space-y-4 bg-[#F6F7FB]">
                  {/* AI Price Estimation Preview */}
                  <div className="bg-white rounded-xl border border-slate-200 border-l-4 border-l-[#FF6B35] p-4">
                    <div className="flex items-center justify-between gap-2 text-xs text-[#6B7280]">
                      <span>AI price estimation preview</span>
                      <span className="text-[#FF6B35] font-medium">Provisional guide</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-4">
                      <div>
                        <div className="text-xs text-[#6B7280]">Estimated range</div>
                        <div className="text-xl font-bold text-[#FF6B35] font-mono-nums">
                          ₦8,000 – ₦12,000
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-[#6B7280]">Suggested deposit</div>
                        <div className="text-lg font-bold text-[#FF6B35] font-mono-nums">
                          ₦2,000
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-[#6B7280] mt-2">
                      Illustrative labor range before parts. Workers submit exact offers for your review.
                    </p>
                  </div>

                  {/* Worker Offer + Contact Protection Preview */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#1A1B25]">
                        Sample offer · Plumbing professional
                      </div>
                      <div className="text-xs text-[#6B7280] mt-0.5">
                        Available tomorrow · Contact details protected until deposit payment
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold text-[#1A1B25] font-mono-nums">₦9,000</div>
                      <div className="text-[11px] text-[#635BFF] font-medium">
                        Ready to accept & pay deposit
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 1. HOW FixIt WORKS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-2xl mb-10">
          <div className="text-xs font-semibold text-[#635BFF] uppercase tracking-wider mb-2">
            How FixIt Works
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1A1B25] [text-wrap:balance]">
            Four structured steps from request to verified booking
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              step: '01',
              title: 'Describe your problem',
              body: 'Write in plain language what needs fixing, your Benin City neighborhood, and optional budget.',
            },
            {
              step: '02',
              title: 'Review AI guidance',
              body: 'FixIt structures your job, suggests missing questions, and shows a provisional indicative price range.',
            },
            {
              step: '03',
              title: 'Compare worker offers',
              body: 'Skilled professionals submit transparent prices, timelines, and availability. Accept one offer atomically.',
            },
            {
              step: '04',
              title: 'Confirm deposit & connect',
              body: 'Pay the booking deposit via Stripe Checkout. Once verified by webhook, both parties unlock phone numbers.',
            },
          ].map((item) => (
            <div
              key={item.step}
              className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col justify-between"
            >
              <div>
                <div className="text-xs font-mono-nums font-semibold text-[#FF6B35] mb-3">
                  {item.step}
                </div>
                <h3 className="text-base font-bold text-[#1A1B25] mb-2">{item.title}</h3>
                <p className="text-sm text-[#6B7280] leading-relaxed">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2. POPULAR SERVICES */}
      <section className="bg-white border-y border-slate-200 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
            <div>
              <div className="text-xs font-semibold text-[#635BFF] uppercase tracking-wider mb-2">
                Popular Services
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-[#1A1B25]">
                Essential home & commercial trades in {SUPPORTED_CITIES[0].name}
              </h2>
            </div>
            <Link
              to="/services"
              className="text-sm font-semibold text-[#635BFF] hover:text-[#4A44C6] inline-flex items-center gap-1 whitespace-nowrap"
            >
              Explore all services
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {SERVICE_CATEGORIES.map((cat) => (
              <div
                key={cat.id}
                className="bg-[#F6F7FB] rounded-xl border border-slate-200 overflow-hidden flex flex-col"
              >
                <div className="aspect-[4/3] bg-slate-200 overflow-hidden">
                  <img
                    src={cat.imageUrl}
                    alt={cat.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between bg-white">
                  <div>
                    <div className="text-xs text-[#6B7280] mb-1">Benin City · Category</div>
                    <h3 className="text-lg font-bold text-[#1A1B25]">{cat.name}</h3>
                    <p className="text-sm text-[#6B7280] mt-2 leading-relaxed">
                      {cat.shortDescription}
                    </p>
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <Link
                      to="/signup"
                      className="text-sm font-semibold text-[#635BFF] hover:text-[#4A44C6] inline-flex items-center gap-1"
                    >
                      Request {cat.name.toLowerCase()}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. HOW AI HELPS YOU (Interactive Live Preview) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-5 space-y-5">
            <div className="text-xs font-semibold text-[#635BFF] uppercase tracking-wider">
              FixIt Intelligence
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-[#1A1B25] [text-wrap:balance]">
              Practical AI that clarifies jobs before workers bid
            </h2>
            <p className="text-sm text-[#6B7280] leading-relaxed">
              Instead of forcing customers to fill complex technical forms, FixIt Intelligence extracts category, location, urgency, and helpful follow-up questions directly from plain descriptions—and compares incoming offers transparently.
            </p>
            <ul className="space-y-3 text-sm text-[#1A1B25]">
              <li className="flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-[#635BFF] shrink-0 mt-1" />
                <span>Extracts service category, neighborhood, and urgency with Zod-validated JSON</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-[#FF6B35] shrink-0 mt-1" />
                <span>Produces provisional price ranges grounded in editable local baselines</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-[#00C853] shrink-0 mt-1" />
                <span>Gracefully falls back to manual category selection when input is unclear</span>
              </li>
            </ul>
          </div>

          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
            <form onSubmit={handleAnalyzePreview} className="space-y-4">
              <label htmlFor="demo-job-input" className="block text-sm font-semibold text-[#1A1B25]">
                Try FixIt Intelligence on a sample request
              </label>
              <textarea
                id="demo-job-input"
                rows={3}
                value={demoInput}
                onChange={(e) => setDemoInput(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-[#1A1B25] focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                placeholder="Describe what you need and your Benin City location..."
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-[#6B7280]">
                  Runs on server-side Groq AI with manual fallback
                </span>
                <button
                  type="submit"
                  disabled={demoLoading}
                  className="px-4 py-2 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                >
                  {demoLoading ? 'Analyzing...' : 'Analyze Request'}
                </button>
              </div>
            </form>

            {demoError && (
              <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#FF3B30]">
                {demoError}
              </div>
            )}

            {demoResult && (
              <div className="mt-5 pt-5 border-t border-slate-100 space-y-4">
                {!demoResult.validation.valid ? (
                  <div className="p-4 rounded-xl bg-[#F6F7FB] border border-slate-200 text-sm text-[#1A1B25]">
                    <div className="font-semibold text-[#FF6B35] mb-1">
                      Clarification needed ({demoResult.validation.status})
                    </div>
                    <p className="text-[#6B7280] text-xs">{demoResult.validation.message}</p>
                  </div>
                ) : (
                  <>
                    {demoResult.understood && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="bg-[#F6F7FB] rounded-lg p-3">
                          <div className="text-[#6B7280]">Category</div>
                          <div className="font-semibold text-[#1A1B25] mt-0.5">
                            {demoResult.understood.category}
                          </div>
                        </div>
                        <div className="bg-[#F6F7FB] rounded-lg p-3">
                          <div className="text-[#6B7280]">Location</div>
                          <div className="font-semibold text-[#1A1B25] mt-0.5">
                            {demoResult.understood.location || 'Not specified'}
                          </div>
                        </div>
                        <div className="bg-[#F6F7FB] rounded-lg p-3">
                          <div className="text-[#6B7280]">Urgency</div>
                          <div className="font-semibold text-[#1A1B25] mt-0.5">
                            {demoResult.understood.urgency}
                          </div>
                        </div>
                        <div className="bg-[#F6F7FB] rounded-lg p-3">
                          <div className="text-[#6B7280]">Service Type</div>
                          <div className="font-semibold text-[#1A1B25] mt-0.5">
                            {demoResult.understood.serviceType}
                          </div>
                        </div>
                      </div>
                    )}

                    {demoResult.estimate && (
                      <div className="bg-white rounded-xl border border-slate-200 border-l-4 border-l-[#FF6B35] p-4">
                        <div className="text-xs text-[#6B7280]">
                          {demoResult.estimate.dataQuality}
                        </div>
                        <div className="text-lg font-bold text-[#FF6B35] font-mono-nums mt-1">
                          ₦{demoResult.estimate.estimatedMin.toLocaleString('en-NG')} – ₦
                          {demoResult.estimate.estimatedMax.toLocaleString('en-NG')}
                        </div>
                        <p className="text-xs text-[#6B7280] mt-1">
                          {demoResult.estimate.explanation}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 4. WHY CHOOSE FixIt */}
      <section className="bg-white border-y border-slate-200 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-10">
            <div className="text-xs font-semibold text-[#635BFF] uppercase tracking-wider mb-2">
              Built for Trust
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-[#1A1B25]">
              Why customers and technicians use FixIt
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-2">
              <Lock className="w-5 h-5 text-[#635BFF]" />
              <h3 className="text-base font-bold text-[#1A1B25]">Backend-enforced contact privacy</h3>
              <p className="text-sm text-[#6B7280] leading-relaxed">
                Phone numbers never appear in public job listings or unconfirmed bookings. Contact endpoints verify verified Stripe payment status before releasing numbers.
              </p>
            </div>
            <div className="space-y-2">
              <ShieldCheck className="w-5 h-5 text-[#00C853]" />
              <h3 className="text-base font-bold text-[#1A1B25]">Atomic single-worker booking</h3>
              <p className="text-sm text-[#6B7280] leading-relaxed">
                Database row locking guarantees only one offer can be accepted per job, automatically closing competing pending offers and preventing double bookings.
              </p>
            </div>
            <div className="space-y-2">
              <UserCheck className="w-5 h-5 text-[#FF6B35]" />
              <h3 className="text-base font-bold text-[#1A1B25]">Reviews tied to completed jobs</h3>
              <p className="text-sm text-[#6B7280] leading-relaxed">
                Worker ratings are calculated strictly from real reviews submitted on completed bookings, with one review allowed per booking.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. BECOME A SERVICE PROVIDER */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-center space-y-5">
            <div className="text-xs font-semibold text-[#FF6B35] uppercase tracking-wider">
              For Skilled Professionals
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-[#1A1B25] [text-wrap:balance]">
              Receive serious local leads in Benin City without cold chasing
            </h2>
            <p className="text-sm text-[#6B7280] leading-relaxed">
              Set your trade categories, choose the neighborhoods you cover, browse structured job requests, and submit transparent offers. Customers pay a booking deposit before contact exchange.
            </p>
            <div>
              <Link
                to="/signup?role=worker"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold transition-colors"
              >
                Create Worker Account
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
          <div className="lg:col-span-5 bg-slate-100 min-h-[260px]">
            <img
              src="/src/assets/images/worker_team_portrait_1795040956540.jpg"
              alt="Nigerian home service professional reviewing a job schedule"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* 6. FREQUENTLY ASKED QUESTIONS */}
      <section className="bg-white border-t border-slate-200 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1A1B25] mb-8 text-center">
            Frequently Asked Questions
          </h2>
          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {FAQS.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={faq.q} className="py-4">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 text-left text-sm sm:text-base font-semibold text-[#1A1B25]"
                  >
                    <span>{faq.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#6B7280] shrink-0 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="mt-2.5 text-sm text-[#6B7280] leading-relaxed">{faq.a}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 7. FINAL CTA */}
      <section className="bg-[#1A1B25] text-white py-14">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold [text-wrap:balance]">
            Ready to post a job or start receiving offers in Benin City?
          </h2>
          <p className="text-sm sm:text-base text-white/75">
            Find help. Compare offers. Book with confidence.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              to="/signup"
              className="px-6 py-3 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold transition-colors"
            >
              Find a Professional
            </Link>
            <Link
              to="/signup?role=worker"
              className="px-6 py-3 rounded-lg border border-white/25 hover:bg-white/10 text-white text-sm font-semibold transition-colors"
            >
              Become a Worker
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
