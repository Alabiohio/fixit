import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';
import { apiRequest } from '../../lib/api';
import { formatNaira } from '../../../shared/constants';
import type { Offer } from '../../types/FixIt';

export function WorkerOffersPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadOffers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ offers: Offer[] }>('/api/offers/my');
      setOffers(res.offers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load offers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOffers();
  }, [loadOffers]);

  async function handleWithdraw(offerId: string) {
    setError('');
    try {
      await apiRequest(`/api/offers/${offerId}/withdraw`, { method: 'PATCH' });
      await loadOffers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to withdraw offer.');
    }
  }

  const filtered = filter === 'all' ? offers : offers.filter((o) => o.status === filter);

  return (
    <AppShell mode="worker" title="My Offers">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1B25]">My Offers</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Track pending, accepted, rejected, withdrawn, and expired offers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg w-fit">
          {['all', 'pending', 'accepted', 'rejected', 'withdrawn', 'expired'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFilter(st)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                filter === st ? 'bg-[#635BFF] text-white' : 'text-[#6B7280] hover:text-[#1A1B25]'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-[#FF3B30]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="h-28 bg-white rounded-2xl border border-slate-200 animate-pulse" />
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
            <p className="text-sm text-[#6B7280]">No offers in this status.</p>
            <Link
              to="/worker/jobs"
              className="inline-block px-4 py-2 rounded-lg bg-[#635BFF] text-white text-xs font-semibold"
            >
              Browse Available Jobs
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((offer) => (
              <div
                key={offer.id}
                className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="text-xs text-[#6B7280]">
                    {offer.job?.category} · {offer.job?.location} · Status:{' '}
                    <span className="font-semibold capitalize text-[#1A1B25]">{offer.status}</span>
                  </div>
                  <Link
                    to={`/worker/jobs/${offer.job_id}`}
                    className="text-base font-bold text-[#1A1B25] hover:text-[#635BFF]"
                  >
                    {offer.job?.title || 'Job Request'}
                  </Link>
                  <div className="text-xs text-[#6B7280]">
                    Completion: {offer.estimated_completion} · Availability: {offer.availability}
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-lg font-bold text-[#1A1B25] font-mono-nums">
                    {formatNaira(offer.proposed_price)}
                  </div>
                  {offer.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => handleWithdraw(offer.id)}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-[#6B7280] hover:text-[#FF3B30] hover:border-[#FF3B30]"
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
