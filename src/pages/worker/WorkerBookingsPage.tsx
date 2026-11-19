import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Lock, Phone } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { apiRequest } from '../../lib/api';
import { formatNaira } from '../../../shared/constants';
import type { Booking } from '../../types/FixIt';

interface UnlockedContact {
  full_name: string;
  phone_number: string;
  city: string;
}

export function WorkerBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [contacts, setContacts] = useState<Record<string, UnlockedContact>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  return (
    <AppShell mode="worker" title="Bookings">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1B25]">Worker Bookings</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Customer phone numbers unlock automatically after their deposit payment is verified via Stripe.
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
                        {isPaid ? 'Deposit confirmed' : 'Awaiting customer deposit'}
                      </div>
                    </div>
                  </div>

                  {!isPaid ? (
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
                        {b.booking_status === 'confirmed' && (
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
