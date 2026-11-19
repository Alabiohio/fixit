import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { PublicNavbar } from '../../components/PublicNavbar';
import { apiRequest } from '../../lib/api';
import type { Booking, PaymentRecord } from '../../types/FixIt';

export function CheckoutSuccessPage() {
  const [searchParams] = useSearchParams();
  const bookingId = searchParams.get('booking_id') || '';
  const [booking, setBooking] = useState<Booking | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!bookingId) {
      setChecking(false);
      return;
    }

    let active = true;
    let attempts = 0;

    async function pollWebhookConfirmation() {
      try {
        const res = await apiRequest<{ booking: Booking; payments: PaymentRecord[] }>(
          `/api/payments/booking-status?bookingId=${encodeURIComponent(bookingId)}`,
        );
        if (!active) return;
        setBooking(res.booking);
        setPayments(res.payments);

        if (res.booking.payment_status !== 'paid' && attempts < 10) {
          attempts += 1;
          setTimeout(pollWebhookConfirmation, 2000);
        } else {
          setChecking(false);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to verify payment status.');
        setChecking(false);
      }
    }

    pollWebhookConfirmation();

    return () => {
      active = false;
    };
  }, [bookingId]);

  const confirmed = booking?.payment_status === 'paid';

  return (
    <div className="min-h-screen bg-[#F6F7FB] flex flex-col">
      <PublicNavbar />
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-5">
          {confirmed ? (
            <>
              <CheckCircle2 className="w-14 h-14 text-[#00C853] mx-auto" />
              <h1 className="text-2xl font-bold text-[#1A1B25]">
                Deposit Payment Confirmed
              </h1>
              <p className="text-sm text-[#6B7280] leading-relaxed">
                Stripe verified your booking deposit via webhook. Your booking is now confirmed and both you and the worker can view each other&apos;s phone numbers.
              </p>
              {payments[0]?.notes && (
                <p className="text-xs text-[#6B7280] bg-[#F6F7FB] rounded-lg p-3">
                  {payments[0].notes}
                </p>
              )}
              <Link
                to="/customer/bookings"
                className="inline-block px-6 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold"
              >
                View Booking & Worker Contact
              </Link>
            </>
          ) : (
            <>
              <Clock className="w-12 h-12 text-[#FF6B35] mx-auto" />
              <h1 className="text-xl font-bold text-[#1A1B25]">
                {checking
                  ? 'Awaiting Stripe webhook confirmation...'
                  : 'Payment confirmation pending'}
              </h1>
              <p className="text-sm text-[#6B7280] leading-relaxed">
                For your security, FixIt never unlocks contact details from redirect URLs alone—only a signed Stripe webhook confirms payment.
              </p>
              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#FF3B30]">
                  {error}
                </div>
              )}
              <div className="pt-2">
                <Link
                  to="/customer/bookings"
                  className="inline-block px-5 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold"
                >
                  Go to My Bookings
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export function CheckoutCancelPage() {
  const [searchParams] = useSearchParams();
  const bookingId = searchParams.get('booking_id');

  return (
    <div className="min-h-screen bg-[#F6F7FB] flex flex-col">
      <PublicNavbar />
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-5">
          <XCircle className="w-14 h-14 text-[#FF3B30] mx-auto" />
          <h1 className="text-2xl font-bold text-[#1A1B25]">
            Deposit Payment Cancelled
          </h1>
          <p className="text-sm text-[#6B7280] leading-relaxed">
            No deposit charge was completed. Contact information remains locked, and your booking is preserved so you can retry payment anytime.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Link
              to="/customer/bookings"
              className="px-6 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold"
            >
              {bookingId ? 'Return to Bookings & Retry' : 'Go to Bookings'}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
