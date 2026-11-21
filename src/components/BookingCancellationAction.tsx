import { useState } from 'react';
import type { Booking } from '../types/bookam';

interface BookingCancellationActionProps {
  booking: Booking;
  pending: boolean;
  onCancel: (reason: string) => Promise<void>;
}

export function BookingCancellationAction({
  booking,
  pending,
  onCancel,
}: BookingCancellationActionProps) {
  const [reason, setReason] = useState('');
  const reviewRequest = booking.cancellation_request;
  const inPersonBalanceNeedsReview =
    booking.balance_payment_method === 'in_person' &&
    (booking.balance_payment_status === 'reported' || booking.balance_payment_status === 'paid');

  if (booking.booking_status === 'cancelled' || booking.booking_status === 'completed') {
    return null;
  }

  if (booking.booking_status === 'cancellation_pending') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-3">
        <p>Cancellation is processing. Do not start or continue work until it finishes.</p>
        <button
          type="button"
          disabled={pending}
          onClick={() => void onCancel('')}
          className="rounded-lg border border-amber-500 px-3.5 py-2 text-xs font-semibold text-amber-900 disabled:opacity-60"
        >
          {pending ? 'Retrying cancellation...' : 'Retry cancellation'}
        </button>
      </div>
    );
  }

  if (reviewRequest?.status === 'pending_review') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
        A cancellation request is waiting for manual review. The booking remains active and no
        refund has been issued yet.
        {reviewRequest.reason && (
          <p className="mt-2">
            Reason: <span className="font-medium">{reviewRequest.reason}</span>
          </p>
        )}
      </div>
    );
  }

  if (booking.booking_status === 'in_progress') {
    return (
      <form
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onCancel(reason.trim());
        }}
      >
        <div>
          <h3 className="text-sm font-bold text-amber-950">Request cancellation review</h3>
          <p className="mt-1 text-xs text-amber-900">
            Work has started, so FixIt will review the request before deciding how paid funds are handled.
          </p>
        </div>
        {reviewRequest?.status === 'failed' && reviewRequest.review_note && (
          <p className="text-xs text-red-700">{reviewRequest.review_note}</p>
        )}
        <textarea
          required
          minLength={10}
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Explain why you are requesting cancellation"
          className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-amber-500 px-3.5 py-2 text-xs font-semibold text-amber-900 disabled:opacity-60"
        >
          {pending ? 'Submitting request...' : 'Submit cancellation request'}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-2">
      {reviewRequest?.status === 'failed' && reviewRequest.review_note && (
        <p className="text-xs text-red-700">{reviewRequest.review_note}</p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            window.confirm(
              inPersonBalanceNeedsReview
                ? 'A reported or paid in-person balance requires manual review. Submit a cancellation request without an automatic refund?'
                : 'Cancel this booking before work starts? Any successful Stripe payments will be refunded.',
            )
          ) {
            void onCancel('');
          }
        }}
        className="rounded-lg border border-red-200 px-3.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        {pending ? 'Cancelling booking...' : 'Cancel booking'}
      </button>
    </div>
  );
}
