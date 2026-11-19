-- FixIt Initial Database Schema (Supabase PostgreSQL)
-- Run in Supabase SQL Editor or via Supabase CLI migrations

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone_number TEXT NOT NULL DEFAULT '',
  avatar_url TEXT DEFAULT '',
  city TEXT NOT NULL DEFAULT 'Benin City',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Worker Profiles
CREATE TABLE IF NOT EXISTS public.worker_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  bio TEXT NOT NULL DEFAULT '',
  service_categories TEXT[] NOT NULL DEFAULT '{}',
  service_locations TEXT[] NOT NULL DEFAULT '{}',
  availability TEXT NOT NULL DEFAULT 'Available this week',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Editable Local Pricing Configuration (Provisional Benin City baselines + extensible cities)
CREATE TABLE IF NOT EXISTS public.pricing_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city TEXT NOT NULL DEFAULT 'Benin City',
  category TEXT NOT NULL,
  service_type TEXT NOT NULL DEFAULT 'Standard',
  min_price INTEGER NOT NULL CHECK (min_price >= 0),
  max_price INTEGER NOT NULL CHECK (max_price >= min_price),
  suggested_deposit INTEGER NOT NULL DEFAULT 2000 CHECK (suggested_deposit >= 0),
  currency TEXT NOT NULL DEFAULT 'ngn',
  is_provisional BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (city, category, service_type)
);

-- 4. Jobs
CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Benin City',
  location TEXT NOT NULL,
  budget INTEGER CHECK (budget IS NULL OR budget >= 0),
  estimated_min INTEGER CHECK (estimated_min IS NULL OR estimated_min >= 0),
  estimated_max INTEGER CHECK (estimated_max IS NULL OR estimated_max >= 0),
  suggested_deposit INTEGER CHECK (suggested_deposit IS NULL OR suggested_deposit >= 0),
  estimate_explanation TEXT DEFAULT '',
  estimate_assumptions TEXT[] DEFAULT '{}',
  estimate_is_provisional BOOLEAN NOT NULL DEFAULT TRUE,
  urgency TEXT NOT NULL DEFAULT 'Medium' CHECK (urgency IN ('Low', 'Medium', 'High', 'Emergency')),
  reference_image_url TEXT DEFAULT '',
  additional_questions TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Offers
CREATE TABLE IF NOT EXISTS public.offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proposed_price INTEGER NOT NULL CHECK (proposed_price > 0),
  estimated_completion TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT 'Available tomorrow',
  message TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate active offers from the same worker on the same job
CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_unique_active_worker_job
  ON public.offers (job_id, worker_id)
  WHERE status IN ('pending', 'accepted');

-- 6. Bookings
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
  offer_id UUID NOT NULL UNIQUE REFERENCES public.offers(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agreed_price INTEGER NOT NULL CHECK (agreed_price > 0),
  deposit_amount INTEGER NOT NULL CHECK (deposit_amount > 0),
  currency TEXT NOT NULL DEFAULT 'ngn',
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded')),
  booking_status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (booking_status IN ('pending_payment', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Payments
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'ngn',
  display_amount_ngn INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'expired', 'refunded')),
  raw_event_id TEXT UNIQUE,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'system',
  link TEXT DEFAULT '',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Reviews
CREATE TABLE IF NOT EXISTS public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_jobs_status_category ON public.jobs (status, category, location);
CREATE INDEX IF NOT EXISTS idx_jobs_customer_id ON public.jobs (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_job_id ON public.offers (job_id, status);
CREATE INDEX IF NOT EXISTS idx_offers_worker_id ON public.offers (worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON public.bookings (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_worker_id ON public.bookings (worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON public.payments (booking_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_worker_id ON public.reviews (worker_id);

-- Updated_at trigger helper
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_worker_profiles_updated_at ON public.worker_profiles;
CREATE TRIGGER trg_worker_profiles_updated_at BEFORE UPDATE ON public.worker_profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_pricing_configs_updated_at ON public.pricing_configs;
CREATE TRIGGER trg_pricing_configs_updated_at BEFORE UPDATE ON public.pricing_configs FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON public.jobs;
CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_offers_updated_at ON public.offers;
CREATE TRIGGER trg_offers_updated_at BEFORE UPDATE ON public.offers FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Auto-create profile when a user signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone_number, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data ->> 'phone_number', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed editable provisional local pricing baselines for Benin City
INSERT INTO public.pricing_configs (city, category, service_type, min_price, max_price, suggested_deposit, currency, is_provisional, notes)
VALUES
  ('Benin City', 'Plumbing', 'Repair', 7000, 15000, 2000, 'ngn', TRUE, 'Provisional baseline for minor leak or tap repairs excluding major replacement parts.'),
  ('Benin City', 'Electrical repairs', 'Repair', 6000, 14000, 2000, 'ngn', TRUE, 'Provisional baseline for socket, breaker, or wiring fault diagnostics and repair.'),
  ('Benin City', 'Painting', 'Interior', 18000, 45000, 3500, 'ngn', TRUE, 'Provisional baseline per room labor estimate excluding paint materials.'),
  ('Benin City', 'AC repairs and maintenance', 'Servicing', 8000, 22000, 2500, 'ngn', TRUE, 'Provisional baseline for split-unit cleaning, inspection, or minor servicing excluding gas refill.'),
  ('Benin City', 'Cleaning', 'Deep Clean', 10000, 25000, 2000, 'ngn', TRUE, 'Provisional baseline for residential apartment deep cleaning based on room count.')
ON CONFLICT (city, category, service_type) DO NOTHING;
