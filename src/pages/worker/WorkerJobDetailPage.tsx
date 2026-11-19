import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { PriceEstimateCard } from '../../components/PriceEstimateCard';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../lib/api';
import { formatNaira } from '../../../shared/constants';
import type { Job, Offer } from '../../types/FixIt';

export function WorkerJobDetailPage() {
  const { id } = useParams();
  const { workerProfile } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [myOffers, setMyOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  const [proposedPrice, setProposedPrice] = useState('');
  const [estimatedCompletion, setEstimatedCompletion] = useState('Same day (2–3 hours)');
  const [availability, setAvailability] = useState('Available tomorrow');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadJob = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<{ job: Job; offers: Offer[] }>(`/api/jobs/${id}`);
      setJob(data.job);
      setMyOffers(data.offers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load job.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  const activeOffer = myOffers.find((o) => o.status === 'pending' || o.status === 'accepted');

  async function handleSubmitOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      await apiRequest('/api/offers', {
        method: 'POST',
        body: JSON.stringify({
          job_id: id,
          proposed_price: Math.round(Number(proposedPrice)),
          estimated_completion: estimatedCompletion,
          availability,
          message,
        }),
      });
      setSuccess('Your offer was submitted to the customer.');
      await loadJob();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit offer.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell mode="worker" title="Job Details">
      <div className="max-w-3xl space-y-6">
        <Link
          to="/worker/jobs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#635BFF] hover:text-[#4A44C6]"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Job Board
        </Link>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-[#FF3B30]">
            {error}
          </div>
        )}
        {success && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
            {success}
          </div>
        )}

        {loading || !job ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-sm text-[#6B7280]">
            {loading ? 'Loading job...' : 'Job unavailable.'}
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="text-xs text-[#6B7280]">
                {job.category} · {job.location}, {job.city} · Urgency: {job.urgency} · Customer:{' '}
                {job.customer_name || 'Customer'}
              </div>
              <h1 className="text-2xl font-bold text-[#1A1B25]">{job.title}</h1>
              <p className="text-sm text-[#1A1B25] leading-relaxed">{job.description}</p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100 text-xs">
                <div>
                  <span className="text-[#6B7280]">Customer budget</span>
                  <div className="font-semibold text-[#1A1B25] font-mono-nums mt-0.5">
                    {job.budget ? formatNaira(job.budget) : 'Not specified'}
                  </div>
                </div>
                <div>
                  <span className="text-[#6B7280]">Offers on job</span>
                  <div className="font-semibold text-[#1A1B25] font-mono-nums mt-0.5">
                    {job.offer_count || 0}
                  </div>
                </div>
                <div>
                  <span className="text-[#6B7280]">Posted</span>
                  <div className="font-semibold text-[#1A1B25] mt-0.5">
                    {new Date(job.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {job.reference_image_url && (
                <img
                  src={job.reference_image_url}
                  alt="Job reference"
                  referrerPolicy="no-referrer"
                  className="max-h-60 rounded-xl border border-slate-200 object-cover"
                />
              )}

              <div className="flex items-center gap-2 text-xs text-[#6B7280] bg-[#F6F7FB] rounded-lg p-3">
                <Lock className="w-4 h-4 text-[#FF6B35] shrink-0" />
                <span>
                  Customer contact details will become available after the booking is confirmed.
                </span>
              </div>
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
                  isProvisional: true,
                  disclaimer: 'Provisional guide range only. Quote fairly based on the work required.',
                }}
              />
            )}

            {/* Submit Offer or Show Existing Offer */}
            {activeOffer ? (
              <div className="bg-white rounded-2xl border border-[#635BFF]/40 p-6 space-y-2">
                <div className="text-xs font-semibold text-[#635BFF] uppercase">
                  Your active offer · {activeOffer.status}
                </div>
                <div className="text-xl font-bold text-[#1A1B25] font-mono-nums">
                  {formatNaira(activeOffer.proposed_price)}
                </div>
                <div className="text-xs text-[#6B7280]">
                  Completion: {activeOffer.estimated_completion} · Availability: {activeOffer.availability}
                </div>
                {activeOffer.message && (
                  <p className="text-sm text-[#1A1B25] pt-1">{activeOffer.message}</p>
                )}
              </div>
            ) : !workerProfile ? (
              <div className="bg-white rounded-2xl border border-[#FF6B35]/50 p-6 space-y-3">
                <h2 className="text-base font-bold text-[#1A1B25]">
                  Worker Profile Required
                </h2>
                <p className="text-sm text-[#6B7280]">
                  Before submitting offers, set up your Worker Profile with your bio, service categories, and Benin City coverage areas.
                </p>
                <Link
                  to="/worker/profile"
                  className="inline-block px-4 py-2 rounded-lg bg-[#635BFF] text-white text-xs font-semibold"
                >
                  Complete Worker Profile
                </Link>
              </div>
            ) : (
              <form
                onSubmit={handleSubmitOffer}
                className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4"
              >
                <h2 className="text-lg font-bold text-[#1A1B25]">Submit your offer</h2>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                      Proposed price (₦)
                    </label>
                    <input
                      type="number"
                      required
                      min={500}
                      value={proposedPrice}
                      onChange={(e) => setProposedPrice(e.target.value)}
                      placeholder="9000"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                      Estimated completion time
                    </label>
                    <input
                      type="text"
                      required
                      value={estimatedCompletion}
                      onChange={(e) => setEstimatedCompletion(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                      Availability
                    </label>
                    <input
                      type="text"
                      required
                      value={availability}
                      onChange={(e) => setAvailability(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                    Message to customer (optional)
                  </label>
                  <textarea
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="I can repair your leaking kitchen pipe tomorrow for ₦9,000."
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] disabled:opacity-60 text-white text-sm font-semibold"
                >
                  {submitting ? 'Submitting offer...' : 'Submit Offer'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
