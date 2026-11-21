# FixIt — AI-Powered Local Services Marketplace

**Tagline:** Find help. Compare offers. Book with confidence.  
**Initial Target Market:** Benin City, Edo State, Nigeria (structured to expand to additional cities and categories).

---

## Architecture Overview

- **Frontend:** React 19 + TypeScript + Tailwind CSS v4 + React Router + Lucide Icons
- **Backend Server:** Node.js + Express (`server.ts`, port `3000`) serving both API routes and Vite/built static assets
- **Database, Auth, Storage & Realtime:** Supabase (PostgreSQL, Row Level Security, Auth, Storage, Realtime notifications)
- **AI Engine (`FixIt Intelligence`):** Server-side Groq SDK (`groq-sdk`) with `GROQ_MODEL` env var and strict `zod` response validation + manual fallback
- **Payments:** Stripe Checkout for customer deposits and remaining balances; Paystack transfers for worker payouts
- **Contact Protection:** Phone numbers are never returned in public job, offer, or booking list payloads; `GET /api/bookings/:id/contact` releases phone numbers only after `payment_status === 'paid'`.

---

## 1. Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_URL=http://localhost:3000

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=openai/gpt-oss-120b

STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PAYSTACK_SECRET_KEY=your-paystack-secret-key

FixIt_DEFAULT_CURRENCY=ngn
FixIt_DEFAULT_DEPOSIT=2000
FixIt_STRIPE_FALLBACK_CURRENCY=usd
FixIt_NGN_PER_USD_TEST_RATE=1600
```

> **Note on NGN Currency Support in Stripe Test Accounts:**  
> Not all Stripe test accounts have NGN enabled as a Checkout settlement currency. FixIt attempts `FixIt_DEFAULT_CURRENCY` (`ngn`) first; if Stripe rejects NGN for the test account, it transparently converts the payment to `FixIt_STRIPE_FALLBACK_CURRENCY` (`usd`) using `FixIt_NGN_PER_USD_TEST_RATE` and records the exact conversion note on the `payments` row and booking UI.

Customers pay a 20% deposit through Stripe before contact details are unlocked. After the work is done, the customer can mark the booking complete and then settle the remaining balance in person (confirmed by both participants) or through Stripe. Once both completion and balance payment are confirmed, eligible funds collected by FixIt are credited to the worker's in-app wallet after the 10% platform fee. In-person balance payments are excluded from the wallet credit because they go directly to the worker. Workers can withdraw their available wallet balance through Paystack. Paystack transfers are funded from the FixIt Paystack balance; Stripe proceeds are not automatically available for Paystack payouts.

Customers can permanently delete their own open or cancelled jobs if there is no booking history. Offers attached to a deleted job are removed; jobs with bookings are retained to protect service and payment records.

Either booking participant can cancel before work starts. Successful Stripe payments are refunded; bookings with an in-person balance reported or paid require manual review. Once work is in progress, cancellation requests are saved in `booking_cancellation_requests` for staff review and no automatic refund or booking cancellation occurs. There is not yet an in-app admin review screen.

---

## 2. Database Setup (Supabase SQL Migrations)

1. Create a new Supabase project.
2. Open the **SQL Editor** in your Supabase Dashboard (or use the Supabase CLI).
3. Run the migrations in order:
   - `supabase/migrations/001_bookam_schema.sql`
   - `supabase/migrations/002_rls_and_rpc.sql`
   - `supabase/migrations/003_escrow_20_percent_and_address.sql`
   - `supabase/migrations/004_offer_negotiations.sql`
   - `supabase/migrations/005_worker_payouts_and_balance_payment.sql`
   - `supabase/migrations/006_fix_offer_acceptance_ambiguity.sql`
   - `supabase/migrations/007_worker_wallet.sql`
   - `supabase/migrations/008_complete_before_balance_payment.sql`
   - `supabase/migrations/009_delete_unbooked_jobs.sql`
   - `supabase/migrations/010_booking_cancellation_reviews.sql`
4. In Supabase **Authentication -> Providers**, ensure Email/Password sign-up is enabled. (For quick local testing, you may optionally disable email confirmation in Supabase Auth settings, or confirm emails via the link sent by Supabase).

---

## 3. Running Locally

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`.

---

## 4. Stripe Webhook Setup (Required for Payment Confirmation)

FixIt never unlocks contact details based on redirect URLs—only signed Stripe webhook events confirm payment.

### Local Testing with Stripe CLI

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the `whsec_...` signing secret output by `stripe listen` into `STRIPE_WEBHOOK_SECRET` in `.env` and restart the server.

### Production Webhook

In the Stripe Dashboard (**Developers -> Webhooks -> Add endpoint**):
- **Endpoint URL:** `https://your-domain.com/api/stripe/webhook`
- **Events to listen for:**
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `payment_intent.payment_failed`

### Stripe Test Card

- **Card Number:** `4242 4242 4242 4242`
- **Expiry:** Any future date (`12/29`)
- **CVC:** Any 3 digits (`424`)

---

## 5. Paystack Worker Payout Webhook

In the Paystack Dashboard, configure the transfer webhook to:

- **Endpoint URL:** `https://your-domain.com/api/paystack/webhook`
- **Secret key:** Set the Paystack secret key as `PAYSTACK_SECRET_KEY` in the deployment environment.

Paystack may require an administrator to approve transfers with an OTP depending on the account settings. Verify transfer state in the Paystack Dashboard if a payout remains pending. Test bank resolution and transfers with Paystack test credentials before enabling production payouts.

## 6. Production Build & Deployment

```bash
npm run build
npm start
```

Ensure `NODE_ENV=production` and all secrets are configured in your hosting environment.

### Vercel

The Vercel function in `api/handler.ts` dispatches all `/api/*` requests to the shared Express API, including `/api/config` and the Stripe webhook. The `vercel.json` rewrite routes API requests to that handler and client-side routes to the Vite app. Keep the Vite build output directory set to `dist`, and configure the required environment variables in the Vercel project settings for Production. Set `APP_URL` and `NEXT_PUBLIC_APP_URL` to your deployed site URL, not `http://localhost:3000`.
