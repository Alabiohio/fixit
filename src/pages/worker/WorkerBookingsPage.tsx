import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Lock, Phone } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { BookingCancellationAction } from '../../components/BookingCancellationAction';
import { apiRequest } from '../../lib/api';
import { formatNaira } from '../../../shared/constants';
import type { Booking } from '../../types/bookam';

interface UnlockedContact {
  full_name: string;
  phone_number: string;
  city: string;
  address: string;
}

export function WorkerBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [contacts, setContacts] = useState<Record<string, UnlockedContact>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmingBalanceId, setConfirmingBalanceId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ bookings: Booking[] }>('/api/bookings/my?role=worker');
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

  async function handleRevealContact(bookingId: string) {
    setError('');
    try {
      const res = await apiRequest<{ contact: UnlockedContact }>(
        `/api/bookings/${bookingId}/contact`,
      );
      setContacts((prev) => ({ ...prev, [bookingId]: res.contact }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Customer contact is locked.');
    }
  }

  async function handleMarkInProgress(bookingId: string) {
    setError('');
    try {
      await apiRequest(`/api/bookings/${bookingId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'in_progress' }),
      });
      await loadBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update booking status.');
    }
  }

  async function handleCancelBooking(bookingId: string, reason: string) {
    setCancellingId(bookingId);
    setError('');
    try {
      await apiRequest(`/api/bookings/${bookingId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled', cancellationReason: reason }),
      });
      await loadBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel booking.');
    } finally {
      setCancellingId(null);
    }
  }

  async function handleConfirmInPersonBalance(bookingId: string) {
    setConfirmingBalanceId(bookingId);
    setError('');
    try {
      await apiRequest(`/api/bookings/${bookingId}/balance/in-person-confirmation`, {
        method: 'POST',
      });
      await loadBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to confirm in-person payment.');
    } finally {
      setConfirmingBalanceId(null);
    }
  }

  return (
    <AppShell mode="worker" title="Bookings">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1B25]">Worker Bookings</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Customer contact unlocks after the Stripe deposit is verified. Eligible funds are credited to your FixIt wallet after completion and payment of the remaining balance.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-[#FF3B30]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="h-28 bg-white rounded-2xl border border-slate-200 animate-pulse" />
        ) : bookings.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-[#6B7280]">
            No bookings yet. Submit offers on open jobs to win bookings.
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map((b) => {
              const isPaid = b.payment_status === 'paid';
              const unlocked = contacts[b.id];

              return (
                <div key={b.id} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                      <div className="text-xs text-[#6B7280]">
                        {b.job?.category} · {b.job?.location} · Status:{' '}
                        <span className="font-semibold text-[#1A1B25] capitalize">
                          {b.booking_status.replace('_', ' ')}
                        </span>
                      </div>
                      <h2 className="text-lg font-bold text-[#1A1B25] mt-1">
                        {b.job?.title || 'Service Booking'}
                      </h2>
                      <div className="text-sm text-[#6B7280] mt-1">
                        Customer: <span className="font-semibold text-[#1A1B25]">{b.counterpart?.full_name}</span>
                      </div>
                    </div>

                    <div className="text-left sm:text-right shrink-0">
                      <div className="text-lg font-bold text-[#1A1B25] font-mono-nums">
                        {formatNaira(b.agreed_price)}
                      </div>
                      <div
                        className={`text-xs font-semibold mt-1 ${
                          isPaid ? 'text-[#00C853]' : 'text-[#FF6B35]'
                        }`}
                      >
                        {isPaid
                          ? 'Deposit confirmed'
                          : b.payment_status === 'refunded'
                            ? 'Payment refunded'
                            : 'Awaiting customer deposit'}
                      </div>
                    </div>
                  </div>

                  <BookingCancellationAction
                    booking={b}
                    pending={cancellingId === b.id}
                    onCancel={(reason) => handleCancelBooking(b.id, reason)}
                  />

                  {isPaid &&
                    b.booking_status !== 'cancelled' &&
                    b.booking_status !== 'cancellation_pending' &&
                    b.cancellation_request?.status !== 'pending_review' &&
                    b.balance_payment_status !== 'not_applicable' &&
                    b.agreed_price > b.deposit_amount && (
                      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                        <div>
                          <h3 className="text-sm font-bold text-[#1A1B25]">Remaining 80% balance</h3>
                          <p className="text-xs text-[#6B7280] mt-1">
                            {formatNaira(b.agreed_price - b.deposit_amount)} ·{' '}
                            {b.balance_payment_method === 'online'
                              ? 'Online payment'
                              : b.balance_payment_method === 'in_person'
                                ? 'In-person payment'
                                : 'Payment method not selected'}
                          </p>
                        </div>
                        <div className="text-xs text-[#6B7280]">
                          Balance status: {b.balance_payment_status.replace('_', ' ')}
                        </div>
                        {b.balance_payment_method === 'in_person' && (
                          <div>
                            <p className="text-xs text-[#6B7280] mb-2">
                              Customer confirmation: {b.balance_customer_confirmed_at ? 'confirmed' : 'waiting'} ·
                              {' '}Your confirmation: {b.balance_worker_confirmed_at ? 'confirmed' : 'waiting'}
                            </p>
                            {!b.balance_worker_confirmed_at && (
                              <button
                                type="button"
                                disabled={confirmingBalanceId === b.id}
                                onClick={() => handleConfirmInPersonBalance(b.id)}
                                className="px-3.5 py-2 rounded-lg border border-[#635BFF] text-[#635BFF] text-xs font-semibold disabled:opacity-60"
                              >
                                {confirmingBalanceId === b.id
                                  ? 'Confirming...'
                                  : 'Confirm in-person payment received'}
                              </button>
                            )}
                          </div>
                        )}
                        {b.balance_payment_method === 'online' &&
                          b.balance_payment_status === 'pending' && (
                            <p className="text-xs text-[#6B7280]">Waiting for Stripe payment confirmation.</p>
                          )}
                      </div>
                    )}

                  {b.booking_status === 'completed' && b.balance_payment_status === 'paid' && (
                    <div className="bg-emerald-50/60 rounded-xl border border-emerald-200 p-4 text-xs text-emerald-900">
                      {b.wallet_credit
                        ? `${formatNaira(b.wallet_credit)} was credited to your FixIt wallet after the 10% platform fee. Withdraw it from Balance when ready.`
                        : 'Eligible funds are credited to your FixIt wallet automatically after completion.'}
                    </div>
                  )}

                  {b.booking_status === 'cancellation_pending' ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                      Cancellation is being processed. Do not start or continue work until the status updates.
                    </div>
                  ) : b.booking_status === 'cancelled' ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
                      This booking was cancelled.
                      {b.payment_status === 'refunded'
                        ? ' Stripe refund processing has been initiated.'
                        : ' No successful Stripe payment was available to refund.'}
                    </div>
                  ) : !isPaid ? (
                    <div className="bg-[#F6F7FB] rounded-xl border border-slate-200 p-4 flex items-center gap-2.5 text-xs text-[#6B7280]">
                      <Lock className="w-4 h-4 text-[#FF6B35] shrink-0" />
                      <span>
                        Customer contact details will become available after the booking is confirmed.
                      </span>
                    </div>
                  ) : (
                    <div className="bg-emerald-50/60 rounded-xl border border-emerald-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      {unlocked ? (
                        <div className="flex items-center gap-3 text-sm text-[#1A1B25]">
                          <Phone className="w-4 h-4 text-[#00C853]" />
                          <div>
                            <span className="font-semibold">{unlocked.full_name}:</span>{' '}
                            <span className="font-mono-nums font-bold">{unlocked.phone_number}</span>
                            <div className="text-xs text-[#6B7280] mt-0.5">
                              {unlocked.address} · {unlocked.city}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-emerald-900">
                          <CheckCircle2 className="w-4 h-4 text-[#00C853]" />
                          <span>Booking confirmed. You can now access customer phone details.</span>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        {!unlocked && (
                          <button
                            type="button"
                            onClick={() => handleRevealContact(b.id)}
                            className="px-3.5 py-2 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-xs font-semibold"
                          >
                            View Customer Phone
                          </button>
                        )}
                        {b.booking_status === 'confirmed' &&
                          b.cancellation_request?.status !== 'pending_review' && (
                          <button
                            type="button"
                            onClick={() => handleMarkInProgress(b.id)}
                            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-[#F6F7FB] text-xs font-semibold text-[#1A1B25]"
                          >
                            Start Work
                          </button>
                        )}
                      </div>
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
