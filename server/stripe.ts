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

export async function createDepositCheckoutSession(
  params: CreateBookingCheckoutParams,
): Promise<CheckoutSessionResult> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }

  const appUrl = getAppUrl();
  const preferredCurrency = (params.booking.currency || getDefaultCurrency()).toLowerCase();
  const fallbackCurrency = getFallbackCurrency();
  const depositNgn = params.booking.deposit_amount;

  const attemptSession = async (currency: string, majorAmount: number, note: string | null) => {
    const unitAmount = toMinorUnits(majorAmount);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: params.customerEmail || undefined,
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: {
              name: `FixIt Booking Deposit — ${params.jobTitle}`,
              description: note
                ? `Refundable booking confirmation deposit (${note}). Unlocks verified contact details.`
                : 'Booking confirmation deposit. Unlocks worker and customer contact details upon verification.',
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
        display_amount_ngn: String(depositNgn),
        charged_currency: currency,
      },
      payment_intent_data: {
        metadata: {
          booking_id: params.booking.id,
          job_id: params.booking.job_id,
          customer_id: params.booking.customer_id,
          worker_id: params.booking.worker_id,
        },
      },
      success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&booking_id=${params.booking.id}`,
      cancel_url: `${appUrl}/checkout/cancel?booking_id=${params.booking.id}`,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a Checkout URL');
    }

    // Record pending payment attempt
    const { error: insertErr } = await params.supabaseAdmin.from('payments').insert({
      booking_id: params.booking.id,
      stripe_session_id: session.id,
      amount: majorAmount,
      currency,
      display_amount_ngn: depositNgn,
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
    return await attemptSession(preferredCurrency, depositNgn, null);
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
    const fallbackMajor = Math.max(Number((depositNgn / rate).toFixed(2)), 1);
    const conversionNote = `NGN is unsupported on this Stripe test account; converted ₦${depositNgn.toLocaleString('en-NG')} to ${fallbackCurrency.toUpperCase()} ${fallbackMajor.toFixed(2)} at test rate ₦${rate}/1 ${fallbackCurrency.toUpperCase()}`;
    return await attemptSession(fallbackCurrency, fallbackMajor, conversionNote);
  }
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
      .select('id, status')
      .eq('stripe_session_id', verifiedSession.id)
      .maybeSingle();

    if (existingPayment?.status === 'succeeded') {
      return { received: true, duplicate: true, eventType: event.type };
    }

    if (verifiedSession.payment_status === 'paid') {
      const paymentIntentId =
        typeof verifiedSession.payment_intent === 'string'
          ? verifiedSession.payment_intent
          : verifiedSession.payment_intent?.id || null;

      // Update payment record (or upsert if created externally)
      if (existingPayment) {
        await supabaseAdmin
          .from('payments')
          .update({
            status: 'succeeded',
            stripe_payment_intent_id: paymentIntentId,
            raw_event_id: event.id,
          })
          .eq('id', existingPayment.id);
      } else {
        await supabaseAdmin.from('payments').insert({
          booking_id: bookingId,
          stripe_session_id: verifiedSession.id,
          stripe_payment_intent_id: paymentIntentId,
          amount: Math.round((verifiedSession.amount_total || 0) / 100),
          currency: (verifiedSession.currency || 'ngn').toLowerCase(),
          display_amount_ngn: Number(verifiedSession.metadata?.display_amount_ngn || 0) || null,
          status: 'succeeded',
          raw_event_id: event.id,
        });
      }

      // Confirm booking
      const { data: bookingRow } = await supabaseAdmin
        .from('bookings')
        .update({
          payment_status: 'paid',
          booking_status: 'confirmed',
        })
        .eq('id', bookingId)
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
            title: 'Deposit payment confirmed',
            message: `Your booking deposit for "${title}" is confirmed. Worker contact details are now unlocked.`,
            type: 'payment_confirmed',
            link: '/customer/bookings',
          },
          {
            user_id: bookingRow.worker_id,
            title: 'Booking confirmed',
            message: `The customer completed the deposit for "${title}". Customer contact details are now unlocked.`,
            type: 'booking_confirmed',
            link: '/worker/bookings',
          },
        ]);
      }
    }
  } else if (event.type === 'checkout.session.expired') {
    const sessionObj = event.data.object as Stripe.Checkout.Session;
    const bookingId = sessionObj.metadata?.booking_id;

    await supabaseAdmin
      .from('payments')
      .update({ status: 'expired', raw_event_id: event.id })
      .eq('stripe_session_id', sessionObj.id)
      .neq('status', 'succeeded');

    if (bookingId) {
      await supabaseAdmin
        .from('bookings')
        .update({ payment_status: 'failed' })
        .eq('id', bookingId)
        .neq('payment_status', 'paid');
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const bookingId = intent.metadata?.booking_id;

    if (bookingId) {
      await supabaseAdmin
        .from('payments')
        .update({
          status: 'failed',
          stripe_payment_intent_id: intent.id,
          raw_event_id: event.id,
        })
        .eq('booking_id', bookingId)
        .eq('status', 'pending');

      await supabaseAdmin
        .from('bookings')
        .update({ payment_status: 'failed' })
        .eq('id', bookingId)
        .neq('payment_status', 'paid');
    }
  }

  return { received: true, eventType: event.type };
}
