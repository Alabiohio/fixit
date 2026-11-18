# BookAm — AI-Powered Local Services Marketplace

**Tagline:** Find help. Compare offers. Book with confidence.  
**Initial Target Market:** Benin City, Edo State, Nigeria (structured to expand to additional cities and categories).

---

## Architecture Overview

- **Frontend:** React 19 + TypeScript + Tailwind CSS v4 + React Router + Lucide Icons
- **Backend Server:** Node.js + Express (`server.ts`, port `3000`) serving both API routes and Vite/built static assets
- **Database, Auth, Storage & Realtime:** Supabase (PostgreSQL, Row Level Security, Auth, Storage, Realtime notifications)
- **AI Engine (`BookAm Intelligence`):** Server-side Groq SDK (`groq-sdk`) with `GROQ_MODEL` env var and strict `zod` response validation + manual fallback
- **Payments:** Stripe Checkout (test mode) + signed Stripe Webhooks (`POST /api/stripe/webhook`) with idempotent payment/booking updates
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
GROQ_MODEL=llama-3.3-70b-versatile

STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

BOOKAM_DEFAULT_CURRENCY=ngn
BOOKAM_DEFAULT_DEPOSIT=2000
BOOKAM_STRIPE_FALLBACK_CURRENCY=usd
BOOKAM_NGN_PER_USD_TEST_RATE=1600
```

> **Note on NGN Currency Support in Stripe Test Accounts:**  
> Not all Stripe test accounts have NGN enabled as a Checkout settlement currency. BookAm attempts `BOOKAM_DEFAULT_CURRENCY` (`ngn`) first; if Stripe rejects NGN for the test account, it transparently converts the deposit to `BOOKAM_STRIPE_FALLBACK_CURRENCY` (`usd`) using `BOOKAM_NGN_PER_USD_TEST_RATE` and records the exact conversion note on the `payments` row and booking UI.

---

## 2. Database Setup (Supabase SQL Migrations)

1. Create a new Supabase project.
2. Open the **SQL Editor** in your Supabase Dashboard (or use the Supabase CLI).
3. Run the migrations in order:
   - `supabase/migrations/001_bookam_schema.sql`
   - `supabase/migrations/002_rls_and_rpc.sql`
4. In Supabase **Authentication -> Providers**, ensure Email/Password sign-up is enabled. (For quick local testing, you may optionally disable email confirmation in Supabase Auth settings, or confirm emails via the link sent by Supabase).

---

## 3. Running Locally

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`.

---

## 4. Stripe Webhook Setup (Required for Deposit Confirmation)

BookAm never unlocks contact details based on redirect URLs—only signed Stripe webhook events confirm payment.

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

## 5. Production Build & Deployment

```bash
npm run build
npm start
```

Ensure `NODE_ENV=production` and all secrets are configured in your hosting environment.
