import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, Lock, Phone, Star } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { apiRequest } from '../../lib/api';
import { formatNaira } from '../../../shared/constants';
import type { Booking } from '../../types/FixIt';

interface UnlockedContact {
  full_name: string;
  phone_number: string;
  city: string;
}

export function CustomerBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [contacts, setContacts] = useState<Record<string, UnlockedContact>>({});
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState<Record<string, { rating: number; comment: string }>>({});
  const [submittingReviewId, setSubmittingReviewId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadBookings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ bookings: Booking[] }>('/api/bookings/my?role=customer');
      setBookings(res.bookings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load bookings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  async function handlePayDeposit(bookingId: string) {
    setPayingId(bookingId);
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
      setError(err instanceof Error ? err.message : 'Unable to start payment.');
      setPayingId(null);
    }
  }

  async function handleRevealContact(bookingId: string) {
    setError('');
    try {
      const res = await apiRequest<{ contact: UnlockedContact }>(
        `/api/bookings/${bookingId}/contact`,
      );
      setContacts((prev) => ({ ...prev, [bookingId]: res.contact }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Contact details are locked.');
    }
  }

  async function handleUpdateStatus(bookingId: string, status: 'completed' | 'cancelled') {
    setError('');
    try {
      await apiRequest(`/api/bookings/${bookingId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update booking status.');
    }
  }

  async function handleReviewSubmit(bookingId: string) {
    const form = reviewForm[bookingId] || { rating: 5, comment: '' };
    if (form.comment.trim().length < 3) {
      setError('Please write a short review before submitting.');
      return;
    }
    setSubmittingReviewId(bookingId);
    setError('');
    try {
      await apiRequest('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          bookingId,
          rating: form.rating,
          comment: form.comment.trim(),
        }),
      });
      await loadBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit review.');
    } finally {
      setSubmittingReviewId(null);
    }
  }

  return (
    <AppShell mode="customer" title="Bookings">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1B25]">Your Bookings</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Pay deposits via Stripe Checkout, access verified worker phone numbers, and review completed work.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-[#FF3B30]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="h-32 bg-white rounded-2xl border border-slate-200 animate-pulse" />
        ) : bookings.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-[#6B7280]">
            You do not have any bookings yet. Accept an offer on one of your jobs to create a booking.
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map((b) => {
              const isPaid = b.payment_status === 'paid';
              const unlocked = contacts[b.id];
              const currentReview = reviewForm[b.id] || { rating: 5, comment: '' };

              return (
                <div key={b.id} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                      <div className="text-xs text-[#6B7280]">
                        {b.job?.category} · {b.job?.location} · Booking status:{' '}
                        <span className="font-semibold text-[#1A1B25] capitalize">
                          {b.booking_status.replace('_', ' ')}
                        </span>
                      </div>
                      <h2 className="text-lg font-bold text-[#1A1B25] mt-1">
                        {b.job?.title || 'Service Booking'}
                      </h2>
                      <div className="text-sm text-[#6B7280] mt-1">
                        Worker: <span className="font-semibold text-[#1A1B25]">{b.counterpart?.full_name}</span>
                      </div>
                    </div>

                    <div className="text-left sm:text-right shrink-0">
                      <div className="text-lg font-bold text-[#1A1B25] font-mono-nums">
                        {formatNaira(b.agreed_price)}
                      </div>
                      <div className="text-xs text-[#6B7280] font-mono-nums">
                        Deposit: {formatNaira(b.deposit_amount)}
                      </div>
                      <div
                        className={`text-xs font-semibold mt-1 ${
                          isPaid ? 'text-[#00C853]' : 'text-[#FF6B35]'
                        }`}
                      >
                        {isPaid ? 'Payment verified' : `Payment ${b.payment_status}`}
                      </div>
                    </div>
                  </div>

                  {b.latest_payment?.notes && (
                    <div className="text-xs text-[#6B7280] bg-[#F6F7FB] rounded-lg px-3 py-2">
                      Stripe currency note: {b.latest_payment.notes}
                    </div>
                  )}

                  {/* Contact Protection Block */}
                  {!isPaid ? (
                    <div className="bg-[#F6F7FB] rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-2.5 text-xs text-[#1A1B25]">
                        <Lock className="w-4 h-4 text-[#FF6B35] shrink-0" />
                        <span>
                          Complete your booking deposit to unlock this worker&apos;s contact information.
                        </span>
                      </div>
                      {b.booking_status !== 'cancelled' && (
                        <button
                          type="button"
                          disabled={payingId === b.id}
                          onClick={() => handlePayDeposit(b.id)}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-xs font-semibold whitespace-nowrap shrink-0"
                        >
                          <CreditCard className="w-4 h-4" />
                          {payingId === b.id
                            ? 'Redirecting...'
                            : b.payment_status === 'failed'
                              ? 'Retry Deposit Payment'
                              : 'Pay Deposit'}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="bg-emerald-50/60 rounded-xl border border-emerald-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      {unlocked ? (
                        <div className="flex items-center gap-3 text-sm text-[#1A1B25]">
                          <Phone className="w-4 h-4 text-[#00C853]" />
                          <div>
                            <span className="font-semibold">{unlocked.full_name}:</span>{' '}
                            <span className="font-mono-nums font-bold">{unlocked.phone_number}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-emerald-900">
                          <CheckCircle2 className="w-4 h-4 text-[#00C853]" />
                          <span>Deposit verified. Worker contact number is ready to view.</span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        {!unlocked && (
                          <button
                            type="button"
                            onClick={() => handleRevealContact(b.id)}
                            className="px-3.5 py-2 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-xs font-semibold"
                          >
                            View Worker Phone
                          </button>
                        )}
                        {(b.booking_status === 'confirmed' || b.booking_status === 'in_progress') && (
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(b.id, 'completed')}
                            className="px-3.5 py-2 rounded-lg bg-[#00C853] hover:opacity-90 text-white text-xs font-semibold"
                          >
                            Mark Completed
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Review Worker Form for Completed Bookings */}
                  {b.booking_status === 'completed' && (
                    <div className="pt-4 border-t border-slate-100">
                      {b.review ? (
                        <div className="text-xs text-[#6B7280] flex items-center gap-2">
                          <Star className="w-4 h-4 text-[#FF6B35]" />
                          <span>
                            You rated this booking {b.review.rating}/5: &ldquo;{b.review.comment}&rdquo;
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-3 bg-[#F6F7FB] rounded-xl p-4">
                          <div className="text-xs font-semibold text-[#1A1B25]">
                            Rate your experience with {b.counterpart?.full_name}
                          </div>
                          <div className="flex items-center gap-2">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                onClick={() =>
                                  setReviewForm((prev) => ({
                                    ...prev,
                                    [b.id]: { ...currentReview, rating: star },
                                  }))
                                }
                                className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${
                                  currentReview.rating >= star
                                    ? 'bg-[#FF6B35] border-[#FF6B35] text-white'
                                    : 'bg-white border-slate-300 text-[#6B7280]'
                                }`}
                              >
                                {star} ★
                              </button>
                            ))}
                          </div>
                          <textarea
                            rows={2}
                            value={currentReview.comment}
                            onChange={(e) =>
                              setReviewForm((prev) => ({
                                ...prev,
                                [b.id]: { ...currentReview, comment: e.target.value },
                              }))
                            }
                            placeholder="Share honest feedback about punctuality and work quality..."
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                          />
                          <button
                            type="button"
                            disabled={submittingReviewId === b.id}
                            onClick={() => handleReviewSubmit(b.id)}
                            className="px-4 py-2 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-xs font-semibold"
                          >
                            {submittingReviewId === b.id ? 'Submitting...' : 'Submit Review'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
