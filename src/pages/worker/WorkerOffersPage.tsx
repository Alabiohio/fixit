import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../lib/api';
import { formatNaira } from '../../../shared/constants';
import type { Offer } from '../../types/bookam';

export function WorkerOffersPage() {
  const { profile } = useAuth();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [negotiatingId, setNegotiatingId] = useState<string | null>(null);
  const [negotiationPrice, setNegotiationPrice] = useState('');
  const [negotiationMessage, setNegotiationMessage] = useState('');
  const [submittingNegotiationId, setSubmittingNegotiationId] = useState<string | null>(null);
  const [actingOfferId, setActingOfferId] = useState<string | null>(null);

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

  async function handleSubmitNegotiation(e: React.FormEvent, offerId: string) {
    e.preventDefault();
    const proposedPrice = Number(negotiationPrice);
    if (!Number.isInteger(proposedPrice) || proposedPrice <= 0) {
      setError('Enter a valid whole-number counteroffer.');
      return;
    }

    setSubmittingNegotiationId(offerId);
    setError('');
    try {
      await apiRequest(`/api/offers/${offerId}/negotiate`, {
        method: 'POST',
        body: JSON.stringify({
          proposed_price: proposedPrice,
          message: negotiationMessage.trim(),
        }),
      });
      setNegotiatingId(null);
      setNegotiationPrice('');
      setNegotiationMessage('');
      await loadOffers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send counteroffer.');
    } finally {
      setSubmittingNegotiationId(null);
    }
  }

  async function handleCounterofferAction(offerId: string, action: 'accept-counteroffer' | 'decline') {
    setActingOfferId(offerId);
    setError('');
    try {
      await apiRequest(`/api/offers/${offerId}/${action}`, { method: 'POST' });
      await loadOffers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update counteroffer.');
    } finally {
      setActingOfferId(null);
    }
  }

  const filtered = filter === 'all' ? offers : offers.filter((o) => o.status === filter);

  return (
    <AppShell mode="worker" title="My Offers">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1B25]">My Offers</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Track offer decisions and respond to customer counteroffers (up to three rounds).
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
                className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-4"
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
                  {offer.negotiation_count > 0 && (
                    <div className="text-xs text-[#635BFF]">
                      Negotiation {offer.negotiation_count}/3
                      {offer.negotiation_pending
                        ? offer.negotiation_by === profile?.id
                          ? ' · Waiting for customer'
                          : ' · Customer counteroffer'
                        : ' · Counteroffer accepted; waiting for customer'}
                    </div>
                  )}
                  {offer.negotiation_message && (
                    <p className="text-sm text-[#1A1B25] bg-[#F6F7FB] rounded-lg p-2 mt-2">
                      {offer.negotiation_message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-3 shrink-0">
                  <div className="text-lg font-bold text-[#1A1B25] font-mono-nums">
                    {formatNaira(offer.proposed_price)}
                  </div>
                  {offer.status === 'pending' &&
                    offer.negotiation_pending &&
                    offer.negotiation_by !== profile?.id && (
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          disabled={actingOfferId === offer.id}
                          onClick={() =>
                            handleCounterofferAction(offer.id, 'accept-counteroffer')
                          }
                          className="px-3 py-1.5 rounded-lg bg-[#00C853] text-white text-xs font-semibold disabled:opacity-60"
                        >
                          Accept Counter
                        </button>
                        {offer.negotiation_count < 3 && (
                          <button
                            type="button"
                            onClick={() => {
                              setNegotiatingId(
                                negotiatingId === offer.id ? null : offer.id,
                              );
                              setNegotiationPrice(String(offer.proposed_price));
                              setNegotiationMessage('');
                            }}
                            className="px-3 py-1.5 rounded-lg border border-[#635BFF] text-[#635BFF] text-xs font-semibold"
                          >
                            Negotiate
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={actingOfferId === offer.id}
                          onClick={() => handleCounterofferAction(offer.id, 'decline')}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 text-[#6B7280] text-xs font-semibold disabled:opacity-60"
                        >
                          Decline
                        </button>
                      </div>
                    )}
                  {offer.status === 'pending' &&
                    offer.negotiation_pending &&
                    offer.negotiation_by === profile?.id && (
                      <p className="text-xs text-[#6B7280]">Waiting for the customer to respond.</p>
                    )}
                  {offer.status === 'pending' && !offer.negotiation_pending && (
                    <button
                      type="button"
                      onClick={() => handleWithdraw(offer.id)}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-[#6B7280] hover:text-[#FF3B30] hover:border-[#FF3B30]"
                    >
                      Withdraw
                    </button>
                  )}
                </div>
                {negotiatingId === offer.id && (
                  <form
                    onSubmit={(e) => handleSubmitNegotiation(e, offer.id)}
                    className="basis-full grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-3 pt-3 border-t border-slate-100"
                  >
                    <label className="text-xs font-semibold text-[#1A1B25]">
                      Your counteroffer (₦)
                      <input
                        type="number"
                        min="1"
                        max="50000000"
                        step="1"
                        required
                        value={negotiationPrice}
                        onChange={(e) => setNegotiationPrice(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-xs font-semibold text-[#1A1B25]">
                      Message (optional)
                      <input
                        type="text"
                        maxLength={1000}
                        value={negotiationMessage}
                        onChange={(e) => setNegotiationMessage(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={submittingNegotiationId === offer.id}
                      className="self-end px-4 py-2 rounded-lg bg-[#635BFF] text-white text-xs font-semibold disabled:opacity-60"
                    >
                      {submittingNegotiationId === offer.id ? 'Sending...' : 'Send Counteroffer'}
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
