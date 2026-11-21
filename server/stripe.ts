import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getAppUrl,
  getDefaultCurrency,
  getFallbackCurrency,
  getNgnPerUsdRate,
  getStripeSecretKey,
  getStripeWebhookSecret,
} from './config.ts';

let cachedStripe: Stripe | null = null;

export function getStripeClient(): Stripe | null {
  const secretKey = getStripeSecretKey();
  if (!secretKey) return null;
  if (!cachedStripe) {
    cachedStripe = new Stripe(secretKey);
  }
  return cachedStripe;
}

export interface CreateBookingCheckoutParams {
  booking: {
    id: string;
    job_id: string;
    customer_id: string;
    worker_id: string;
    agreed_price: number;
    deposit_amount: number;
    currency: string;
  };
  jobTitle: string;
  customerEmail: string;
  supabaseAdmin: SupabaseClient;
}

export interface CheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  currency: string;
  chargeAmount: number;
  conversionNote: string | null;
}

function toMinorUnits(amountMajor: number): number {
  return Math.max(Math.round(amountMajor * 100), 100);
}

async function createBookingCheckoutSession(
  params: CreateBookingCheckoutParams,
  paymentType: 'deposit' | 'balance',
): Promise<CheckoutSessionResult> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }

  const appUrl = getAppUrl();
  const preferredCurrency = (params.booking.currency || getDefaultCurrency()).toLowerCase();
  const fallbackCurrency = getFallbackCurrency();
  const amountNgn =
    paymentType === 'deposit'
      ? params.booking.deposit_amount
      : params.booking.agreed_price - params.booking.deposit_amount;

  const attemptSession = async (currency: string, majorAmount: number, note: string | null) => {
    const unitAmount = toMinorUnits(majorAmount);
    const isDeposit = paymentType === 'deposit';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: params.customerEmail || undefined,
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: {
              name: `FixIt ${isDeposit ? 'Booking Deposit' : 'Remaining Balance'} — ${params.jobTitle}`,
              description: note
                ? `${isDeposit ? 'Booking confirmation deposit' : 'Remaining service balance'} (${note}).`
                : isDeposit
                  ? 'Booking confirmation deposit. Unlocks worker and customer contact details upon verification.'
                  : 'Remaining service balance after the confirmed booking deposit.',
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id: params.booking.id,
        job_id: params.booking.job_id,
        customer_id: params.booking.customer_id,
        worker_id: params.booking.worker_id,
        display_amount_ngn: String(amountNgn),
        charged_currency: currency,
        payment_type: paymentType,
      },
      payment_intent_data: {
        metadata: {
          booking_id: params.booking.id,
          job_id: params.booking.job_id,
          customer_id: params.booking.customer_id,
          worker_id: params.booking.worker_id,
          payment_type: paymentType,
        },
      },
      success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&booking_id=${params.booking.id}&payment_type=${paymentType}`,
      cancel_url: `${appUrl}/checkout/cancel?booking_id=${params.booking.id}&payment_type=${paymentType}`,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a Checkout URL');
    }

    // Record pending payment attempt
    const { error: insertErr } = await params.supabaseAdmin.from('payments').insert({
      booking_id: params.booking.id,
      stripe_session_id: session.id,
      payment_type: paymentType,
      amount: majorAmount,
      currency,
      display_amount_ngn: amountNgn,
      status: 'pending',
      notes: note || '',
    });

    if (insertErr) {
      console.error('[FixIt Stripe] Failed to record pending payment:', insertErr);
      throw new Error('Could not persist payment session');
    }

    return {
      sessionId: session.id,
      checkoutUrl: session.url,
      currency,
      chargeAmount: majorAmount,
      conversionNote: note,
    };
  };

  try {
    return await attemptSession(preferredCurrency, amountNgn, null);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const currencyUnsupported =
      preferredCurrency !== fallbackCurrency &&
      (message.toLowerCase().includes('currency') ||
        message.toLowerCase().includes('supported') ||
        message.toLowerCase().includes('ngn'));

    if (!currencyUnsupported) {
      throw err;
    }

    // Transparently fall back to configured supported test currency (e.g., USD) and document conversion
    const rate = getNgnPerUsdRate();
    const fallbackMajor = Math.max(Number((amountNgn / rate).toFixed(2)), 1);
    const conversionNote = `NGN is unsupported on this Stripe test account; converted ₦${amountNgn.toLocaleString('en-NG')} to ${fallbackCurrency.toUpperCase()} ${fallbackMajor.toFixed(2)} at test rate ₦${rate}/1 ${fallbackCurrency.toUpperCase()}`;
    return await attemptSession(fallbackCurrency, fallbackMajor, conversionNote);
  }
}

export function createDepositCheckoutSession(
  params: CreateBookingCheckoutParams,
): Promise<CheckoutSessionResult> {
  return createBookingCheckoutSession(params, 'deposit');
}

export function createBalanceCheckoutSession(
  params: CreateBookingCheckoutParams,
): Promise<CheckoutSessionResult> {
  return createBookingCheckoutSession(params, 'balance');
}

export async function refundPaymentIntent(
  paymentIntentId: string,
  idempotencyKey: string,
): Promise<Stripe.Refund> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }

  return stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      reason: 'requested_by_customer',
    },
    { idempotencyKey },
  );
}

export async function handleStripeWebhookEvent(
  rawBody: Buffer,
  signature: string,
  supabaseAdmin: SupabaseClient,
): Promise<{ received: boolean; duplicate?: boolean; eventType: string }> {
  const stripe = getStripeClient();
  const webhookSecret = getStripeWebhookSecret();

  if (!stripe || !webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_NOT_CONFIGURED');
  }

  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  // Idempotency check by raw_event_id
  const { data: existingEvent } = await supabaseAdmin
    .from('payments')
    .select('id, status')
    .eq('raw_event_id', event.id)
    .maybeSingle();

  if (existingEvent) {
    return { received: true, duplicate: true, eventType: event.type };
  }

  if (event.type === 'checkout.session.completed') {
    const sessionObj = event.data.object as Stripe.Checkout.Session;
    // Retrieve fresh session from Stripe to verify payment state independently
    const verifiedSession = await stripe.checkout.sessions.retrieve(sessionObj.id);
    const bookingId = verifiedSession.metadata?.booking_id;

    if (!bookingId) {
      return { received: true, eventType: event.type };
    }

    // Check if this session was already marked succeeded
    const { data: existingPayment } = await supabaseAdmin
      .from('payments')
      .select('id, status, payment_type')
      .eq('stripe_session_id', verifiedSession.id)
      .maybeSingle();

    if (existingPayment?.status === 'succeeded') {
      const { data: existingBooking, error: existingBookingError } = await supabaseAdmin
        .from('bookings')
        .select('booking_status')
        .eq('id', bookingId)
        .maybeSingle();
      if (existingBookingError) throw existingBookingError;

      if (
        existingBooking?.booking_status !== 'cancelled' &&
        existingBooking?.booking_status !== 'cancellation_pending'
      ) {
        return { received: true, duplicate: true, eventType: event.type };
      }
    }

    if (verifiedSession.payment_status === 'paid') {
      const paymentIntentId =
        typeof verifiedSession.payment_intent === 'string'
          ? verifiedSession.payment_intent
          : verifiedSession.payment_intent?.id || null;
      const paymentType =
        existingPayment?.payment_type === 'balance' ||
        verifiedSession.metadata?.payment_type === 'balance'
          ? 'balance'
          : 'deposit';
      let paymentId = existingPayment?.id;

      // Update payment record (or upsert if created externally)
      if (existingPayment) {
        const { error: paymentUpdateError } = await supabaseAdmin
          .from('payments')
          .update({
            status: 'succeeded',
            payment_type: paymentType,
            stripe_payment_intent_id: paymentIntentId,
          })
          .eq('id', existingPayment.id);
        if (paymentUpdateError) throw paymentUpdateError;
      } else {
        const { data: insertedPayment, error: paymentInsertError } = await supabaseAdmin
          .from('payments')
          .insert({
            booking_id: bookingId,
            stripe_session_id: verifiedSession.id,
            stripe_payment_intent_id: paymentIntentId,
            payment_type: paymentType,
            amount: Math.round((verifiedSession.amount_total || 0) / 100),
            currency: (verifiedSession.currency || 'ngn').toLowerCase(),
            display_amount_ngn: Number(verifiedSession.metadata?.display_amount_ngn || 0) || null,
            status: 'succeeded',
          })
          .select('id')
          .single();
        if (paymentInsertError) throw paymentInsertError;
        paymentId = insertedPayment.id;
      }

      const { data: bookingForPayment, error: bookingReadError } = await supabaseAdmin
        .from('bookings')
        .select('id, job_id, customer_id, worker_id, booking_status')
        .eq('id', bookingId)
        .maybeSingle();
      if (bookingReadError) throw bookingReadError;

      if (
        bookingForPayment?.booking_status === 'cancelled' ||
        bookingForPayment?.booking_status === 'cancellation_pending'
      ) {
        if (!paymentIntentId || !paymentId) {
          throw new Error('A paid cancelled booking is missing its Stripe payment intent.');
        }

        const refund = await refundPaymentIntent(paymentIntentId, `fixit-cancel-${paymentId}`);
        if (refund.status === 'failed') {
          throw new Error(`Stripe could not refund cancelled booking payment ${paymentId}.`);
        }

        const { error: paymentRefundError } = await supabaseAdmin
          .from('payments')
          .update({
            status: 'refunded',
            stripe_refund_id: refund.id,
            raw_event_id: event.id,
          })
          .eq('id', paymentId);
        if (paymentRefundError) throw paymentRefundError;

        if (paymentType === 'deposit') {
          const { error: depositRefundError } = await supabaseAdmin
            .from('bookings')
            .update({ payment_status: 'refunded' })
            .eq('id', bookingId);
          if (depositRefundError) throw depositRefundError;
        } else {
          const { error: balanceRefundError } = await supabaseAdmin
            .from('bookings')
            .update({ balance_payment_status: 'refunded' })
            .eq('id', bookingId);
          if (balanceRefundError) throw balanceRefundError;
        }

        if (bookingForPayment.booking_status === 'cancellation_pending') {
          const { data: cancellationRequest, error: cancellationReadError } = await supabaseAdmin
            .from('booking_cancellation_requests')
            .select('id')
            .eq('booking_id', bookingId)
            .eq('status', 'processing')
            .maybeSingle();
          if (cancellationReadError) throw cancellationReadError;

          if (cancellationRequest) {
            const { error: cancellationFinishError } = await supabaseAdmin.rpc(
              'finish_booking_cancellation',
              {
                p_request_id: cancellationRequest.id,
                p_succeeded: true,
                p_deposit_refunded: paymentType === 'deposit',
                p_balance_refunded: paymentType === 'balance',
                p_review_note: 'Stripe completed a checkout after cancellation began; the payment was refunded.',
              },
            );
            if (cancellationFinishError) throw cancellationFinishError;
          }
        }

        await supabaseAdmin.from('notifications').insert([
          {
            user_id: bookingForPayment.customer_id,
            title: 'Cancelled booking payment refunded',
            message: 'A Stripe payment received after cancellation was refunded.',
            type: 'booking_refund',
            link: '/customer/bookings',
          },
          {
            user_id: bookingForPayment.worker_id,
            title: 'Cancelled booking payment refunded',
            message: 'A late Stripe payment for a cancelled booking was refunded.',
            type: 'booking_refund',
            link: '/worker/bookings',
          },
        ]);
        return { received: true, eventType: event.type };
      }

      const { error: paymentEventError } = await supabaseAdmin
        .from('payments')
        .update({ raw_event_id: event.id })
        .eq('id', paymentId);
      if (paymentEventError) throw paymentEventError;

      const bookingUpdate =
        paymentType === 'deposit'
          ? { payment_status: 'paid', booking_status: 'confirmed' }
          : { balance_payment_status: 'paid', balance_payment_method: 'online' };
      const { data: bookingRow } = await supabaseAdmin
        .from('bookings')
        .update(bookingUpdate)
        .eq('id', bookingId)
        .neq('booking_status', 'cancellation_pending')
        .neq('booking_status', 'cancelled')
        .select('id, job_id, customer_id, worker_id')
        .maybeSingle();

      if (bookingRow) {
        const { data: jobRow } = await supabaseAdmin
          .from('jobs')
          .select('title')
          .eq('id', bookingRow.job_id)
          .maybeSingle();

        const title = jobRow?.title || 'your service booking';

        await supabaseAdmin.from('notifications').insert([
          {
            user_id: bookingRow.customer_id,
            title: paymentType === 'deposit' ? 'Deposit payment confirmed' : 'Balance payment confirmed',
            message:
              paymentType === 'deposit'
                ? `Your booking deposit for "${title}" is confirmed. Worker contact details are now unlocked.`
                : `The remaining balance for "${title}" is confirmed online.`,
            type: paymentType === 'deposit' ? 'payment_confirmed' : 'balance_payment_confirmed',
            link: '/customer/bookings',
          },
          {
            user_id: bookingRow.worker_id,
            title: paymentType === 'deposit' ? 'Booking confirmed' : 'Balance payment received',
            message:
              paymentType === 'deposit'
                ? `The customer completed the deposit for "${title}". Customer contact details are now unlocked.`
                : `The customer paid the remaining balance for "${title}" online.`,
            type: paymentType === 'deposit' ? 'booking_confirmed' : 'balance_payment_confirmed',
            link: '/worker/bookings',
          },
        ]);
      }
    }
  } else if (event.type === 'checkout.session.expired') {
    const sessionObj = event.data.object as Stripe.Checkout.Session;
    const bookingId = sessionObj.metadata?.booking_id;
    const paymentType = sessionObj.metadata?.payment_type === 'balance' ? 'balance' : 'deposit';

    await supabaseAdmin
      .from('payments')
      .update({ status: 'expired', raw_event_id: event.id })
      .eq('stripe_session_id', sessionObj.id)
      .neq('status', 'succeeded');

    if (bookingId && paymentType === 'deposit') {
      await supabaseAdmin
        .from('bookings')
        .update({ payment_status: 'failed' })
        .eq('id', bookingId)
        .neq('payment_status', 'paid');
    } else if (bookingId) {
      await supabaseAdmin
        .from('bookings')
        .update({ balance_payment_status: 'failed' })
        .eq('id', bookingId)
        .eq('balance_payment_status', 'pending');
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const bookingId = intent.metadata?.booking_id;
    const paymentType = intent.metadata?.payment_type === 'balance' ? 'balance' : 'deposit';

    if (bookingId) {
      await supabaseAdmin
        .from('payments')
        .update({
          status: 'failed',
          stripe_payment_intent_id: intent.id,
          raw_event_id: event.id,
        })
        .eq('booking_id', bookingId)
        .eq('payment_type', paymentType)
        .eq('status', 'pending');

      if (paymentType === 'deposit') {
        await supabaseAdmin
          .from('bookings')
          .update({ payment_status: 'failed' })
          .eq('id', bookingId)
          .neq('payment_status', 'paid');
      } else {
        await supabaseAdmin
          .from('bookings')
          .update({ balance_payment_status: 'failed' })
          .eq('id', bookingId)
          .eq('balance_payment_status', 'pending');
      }
    }
  }

  return { received: true, eventType: event.type };
}
