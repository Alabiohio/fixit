import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CreditCard, Lock, Sparkles, Star, User } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { PriceEstimateCard } from '../../components/PriceEstimateCard';
import { apiRequest } from '../../lib/api';
import { formatNaira } from '../../../shared/constants';
import type { Booking, Job, Offer, OfferAnalysisResult } from '../../types/FixIt';

export function CustomerJobDetailPage() {
  const { id } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [analysis, setAnalysis] = useState<OfferAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzingOffers, setAnalyzingOffers] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  const loadJob = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<{
        job: Job;
        offers: Offer[];
        booking: Booking | null;
      }>(`/api/jobs/${id}`);
      setJob(data.job);
      setOffers(data.offers);
      setBooking(data.booking);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load job details.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  async function handleAnalyzeOffers() {
    if (!id) return;
    setAnalyzingOffers(true);
    setError('');
    try {
      const res = await apiRequest<{ analysis: OfferAnalysisResult }>('/api/ai/analyze-offers', {
        method: 'POST',
        body: JSON.stringify({ jobId: id }),
      });
      setAnalysis(res.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to analyze offers.');
    } finally {
      setAnalyzingOffers(false);
    }
  }

  async function handleAcceptOffer(offerId: string) {
    if (!id) return;
    setAcceptingId(offerId);
    setError('');
    try {
      await apiRequest(`/api/jobs/${id}/accept-offer`, {
        method: 'POST',
        body: JSON.stringify({ offerId }),
      });
      await loadJob();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to accept offer.');
    } finally {
      setAcceptingId(null);
    }
  }

  async function handleStartCheckout(bookingId: string) {
    setPaying(true);
    setError('');
    try {
      const res = await apiRequest<{ checkoutUrl: string }>(
        '/api/payments/create-checkout-session',
        {
          method: 'POST',
          body: JSON.stringify({ bookingId }),
        },
      );
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start Stripe Checkout.');
      setPaying(false);
    }
  }

  async function handleCancelJob() {
    if (!id) return;
    setError('');
    try {
      await apiRequest(`/api/jobs/${id}/cancel`, { method: 'PATCH' });
      await loadJob();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel job.');
    }
  }

  return (
    <AppShell mode="customer" title="Job Details">
      <div className="space-y-6">
        <Link
          to="/customer/jobs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#635BFF] hover:text-[#4A44C6]"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to My Jobs
        </Link>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-[#FF3B30]">
            {error}
          </div>
        )}

        {loading || !job ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-sm text-[#6B7280]">
            {loading ? 'Loading job details...' : 'Job not found.'}
          </div>
        ) : (
          <>
            {/* Job Overview */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-[#6B7280]">
                    {job.category} · {job.location}, {job.city} · Urgency: {job.urgency}
                  </div>
                  <h1 className="text-2xl font-bold text-[#1A1B25] mt-1">{job.title}</h1>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#635BFF]">
                    Status: {job.status.replace('_', ' ')}
                  </span>
                  {job.status === 'open' && (
                    <button
                      type="button"
                      onClick={handleCancelJob}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-[#6B7280] hover:text-[#FF3B30] hover:border-[#FF3B30]"
                    >
                      Cancel Job
                    </button>
                  )}
                </div>
              </div>

              <p className="text-sm text-[#1A1B25] leading-relaxed">{job.description}</p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100 text-xs">
                <div>
                  <span className="text-[#6B7280]">Customer budget</span>
                  <div className="font-semibold text-[#1A1B25] font-mono-nums mt-0.5">
                    {job.budget ? formatNaira(job.budget) : 'Not specified'}
                  </div>
                </div>
                <div>
                  <span className="text-[#6B7280]">Offers received</span>
                  <div className="font-semibold text-[#1A1B25] font-mono-nums mt-0.5">
                    {offers.filter((o) => o.status !== 'withdrawn').length}
                  </div>
                </div>
                <div>
                  <span className="text-[#6B7280]">Posted on</span>
                  <div className="font-semibold text-[#1A1B25] mt-0.5">
                    {new Date(job.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {job.reference_image_url && (
                <div className="pt-3 border-t border-slate-100">
                  <div className="text-xs text-[#6B7280] mb-2">Reference image</div>
                  <img
                    src={job.reference_image_url}
                    alt="Job reference"
                    referrerPolicy="no-referrer"
                    className="max-h-60 rounded-xl border border-slate-200 object-cover"
                  />
                </div>
              )}
            </div>

            {job.estimated_min !== null && job.estimated_max !== null && (
              <PriceEstimateCard
                estimate={{
                  estimatedMin: job.estimated_min,
                  estimatedMax: job.estimated_max,
                  suggestedDeposit: job.suggested_deposit || 2000,
                  currency: 'ngn',
                  explanation: job.estimate_explanation || 'Provisional local guidance range.',
                  assumptions: job.estimate_assumptions || [],
                  priceDrivers: [],
                  dataQuality: 'Provisional local baseline',
                  isProvisional: Boolean(job.estimate_is_provisional ?? true),
                  disclaimer:
                    'Indicative estimate only — not a guaranteed final quotation.',
                }}
              />
            )}

            {/* Active Booking & Stripe Deposit CTA */}
            {booking && (
              <div className="bg-white rounded-2xl border border-[#635BFF]/40 p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold text-[#635BFF]">
                      Booking created · {booking.booking_status.replace('_', ' ')}
                    </div>
                    <h2 className="text-lg font-bold text-[#1A1B25] mt-1">
                      Agreed offer: <span className="font-mono-nums">{formatNaira(booking.agreed_price)}</span>
                    </h2>
                    <p className="text-xs text-[#6B7280] mt-1">
                      Booking deposit required: <span className="font-mono-nums font-semibold text-[#1A1B25]">{formatNaira(booking.deposit_amount)}</span>
                    </p>
                  </div>

                  {booking.payment_status !== 'paid' ? (
                    <button
                      type="button"
                      disabled={paying}
                      onClick={() => handleStartCheckout(booking.id)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] disabled:opacity-60 text-white text-sm font-semibold"
                    >
                      <CreditCard className="w-4 h-4" />
                      {paying ? 'Redirecting to Stripe...' : 'Pay Deposit via Stripe'}
                    </button>
                  ) : (
                    <Link
                      to="/customer/bookings"
                      className="px-4 py-2 rounded-lg bg-[#00C853] text-white text-sm font-semibold"
                    >
                      Deposit Verified · View Contact
                    </Link>
                  )}
                </div>

                {booking.payment_status !== 'paid' && (
                  <div className="flex items-center gap-2 text-xs text-[#6B7280] bg-[#F6F7FB] rounded-lg p-3">
                    <Lock className="w-4 h-4 text-[#FF6B35] shrink-0" />
                    <span>
                      Complete your booking deposit to unlock this worker&apos;s contact information.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Worker Offers */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-[#1A1B25]">Worker Offers</h2>
                  <p className="text-xs text-[#6B7280]">
                    Compare proposed prices, timelines, and real ratings before accepting one offer.
                  </p>
                </div>

                {offers.filter((o) => o.status === 'pending').length >= 1 && (
                  <button
                    type="button"
                    disabled={analyzingOffers}
                    onClick={handleAnalyzeOffers}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#635BFF] text-[#635BFF] hover:bg-[#635BFF]/5 text-xs font-semibold"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {analyzingOffers ? 'Comparing...' : 'Compare Offers with AI'}
                  </button>
                )}
              </div>

              {analysis && (
                <div className="bg-[#F6F7FB] rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="text-xs font-semibold text-[#635BFF]">
                    FixIt Intelligence · Offer Comparison
                  </div>
                  <p className="text-sm text-[#1A1B25] leading-relaxed">{analysis.summary}</p>
                  <div className="space-y-2">
                    {analysis.comparisons.map((c) => (
                      <div key={c.offerId} className="bg-white rounded-lg border border-slate-200 p-3 text-xs">
                        <div className="flex items-center justify-between gap-2 font-semibold text-[#1A1B25]">
                          <span>{c.workerName}</span>
                          <span className="text-[#FF6B35]">{c.pricePosition}</span>
                        </div>
                        <p className="text-[#6B7280] mt-1">{c.assessment} {c.consideration}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-[#6B7280]">{analysis.guidanceNote}</p>
                </div>
              )}

              {offers.length === 0 ? (
                <div className="py-8 text-center text-sm text-[#6B7280] bg-[#F6F7FB] rounded-xl">
                  No worker offers yet. Skilled professionals in Benin City can see this open job on the board.
                </div>
              ) : (
                <div className="space-y-4">
                  {offers.map((offer) => (
                    <div
                      key={offer.id}
                      className="rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-full bg-[#F6F7FB] border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                          {offer.worker?.avatar_url ? (
                            <img
                              src={offer.worker.avatar_url}
                              alt={offer.worker.full_name}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User className="w-5 h-5 text-[#6B7280]" />
                          )}
                        </div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-[#1A1B25]">
                              {offer.worker?.full_name || 'FixIt Professional'}
                            </span>
                            <span className="text-xs text-[#6B7280]">
                              · {offer.worker?.service_categories?.join(', ') || job.category}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-[#6B7280]">
                            <span className="inline-flex items-center gap-1">
                              <Star className="w-3.5 h-3.5 text-[#FF6B35]" />
                              {offer.worker?.average_rating !== null &&
                              offer.worker?.average_rating !== undefined
                                ? `${offer.worker.average_rating} (${offer.worker.review_count} reviews)`
                                : 'No reviews yet'}
                            </span>
                            <span>· {offer.worker?.completed_jobs || 0} completed jobs</span>
                            <span>· Availability: {offer.availability}</span>
                            <span>· Est. duration: {offer.estimated_completion}</span>
                          </div>
                          {offer.message && (
                            <p className="text-sm text-[#1A1B25] pt-1">{offer.message}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex sm:flex-col items-center sm:items-end justify-between gap-3 shrink-0">
                        <div className="text-xl font-bold text-[#1A1B25] font-mono-nums">
                          {formatNaira(offer.proposed_price)}
                        </div>

                        {offer.status === 'pending' && job.status === 'open' ? (
                          <button
                            type="button"
                            disabled={acceptingId === offer.id}
                            onClick={() => handleAcceptOffer(offer.id)}
                            className="px-4 py-2 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] disabled:opacity-60 text-white text-xs font-semibold whitespace-nowrap"
                          >
                            {acceptingId === offer.id ? 'Accepting...' : 'Accept Offer'}
                          </button>
                        ) : (
                          <span className="text-xs font-semibold capitalize text-[#6B7280]">
                            {offer.status}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
