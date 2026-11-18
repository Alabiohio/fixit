-- BookAm Row Level Security (RLS), Contact Protection, Atomic RPCs & Realtime

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- PROFILES: Strictly private to the profile owner. Never expose phone_number or email publicly via PostgREST.
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- WORKER PROFILES: Authenticated users can browse worker profiles (no phone/email stored here). Workers manage their own.
DROP POLICY IF EXISTS "Anyone authenticated can view worker profiles" ON public.worker_profiles;
CREATE POLICY "Anyone authenticated can view worker profiles" ON public.worker_profiles
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Workers can insert own profile" ON public.worker_profiles;
CREATE POLICY "Workers can insert own profile" ON public.worker_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Workers can update own profile" ON public.worker_profiles;
CREATE POLICY "Workers can update own profile" ON public.worker_profiles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- PRICING CONFIGS: Readable by all, editable only by service_role
DROP POLICY IF EXISTS "Pricing configs readable by all" ON public.pricing_configs;
CREATE POLICY "Pricing configs readable by all" ON public.pricing_configs
  FOR SELECT USING (TRUE);

-- JOBS: Customers manage own jobs; authenticated workers can view open jobs
DROP POLICY IF EXISTS "Customers and workers view eligible jobs" ON public.jobs;
CREATE POLICY "Customers and workers view eligible jobs" ON public.jobs
  FOR SELECT USING (
    auth.uid() = customer_id
    OR (auth.role() = 'authenticated' AND status = 'open')
  );

DROP POLICY IF EXISTS "Customers create own jobs" ON public.jobs;
CREATE POLICY "Customers create own jobs" ON public.jobs
  FOR INSERT WITH CHECK (auth.uid() = customer_id);

DROP POLICY IF EXISTS "Customers update own jobs" ON public.jobs;
CREATE POLICY "Customers update own jobs" ON public.jobs
  FOR UPDATE USING (auth.uid() = customer_id) WITH CHECK (auth.uid() = customer_id);

-- OFFERS: Workers view/manage own offers; customers view offers on their jobs
DROP POLICY IF EXISTS "Offer participants can view offers" ON public.offers;
CREATE POLICY "Offer participants can view offers" ON public.offers
  FOR SELECT USING (
    auth.uid() = worker_id
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = offers.job_id AND j.customer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Workers create own offers on open jobs" ON public.offers;
CREATE POLICY "Workers create own offers on open jobs" ON public.offers
  FOR INSERT WITH CHECK (
    auth.uid() = worker_id
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = offers.job_id AND j.status = 'open' AND j.customer_id <> auth.uid()
    )
  );

DROP POLICY IF EXISTS "Workers can withdraw own pending offers" ON public.offers;
CREATE POLICY "Workers can withdraw own pending offers" ON public.offers
  FOR UPDATE USING (auth.uid() = worker_id AND status = 'pending')
  WITH CHECK (auth.uid() = worker_id AND status IN ('pending', 'withdrawn'));

-- BOOKINGS: Only customer or worker in the booking can view
DROP POLICY IF EXISTS "Booking participants can view bookings" ON public.bookings;
CREATE POLICY "Booking participants can view bookings" ON public.bookings
  FOR SELECT USING (auth.uid() = customer_id OR auth.uid() = worker_id);

-- PAYMENTS: Only booking participants can view payments; mutations happen strictly via service_role webhooks
DROP POLICY IF EXISTS "Booking participants can view payments" ON public.payments;
CREATE POLICY "Booking participants can view payments" ON public.payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = payments.booking_id AND (b.customer_id = auth.uid() OR b.worker_id = auth.uid())
    )
  );

-- NOTIFICATIONS: Users only see and update their own notifications
DROP POLICY IF EXISTS "Users view own notifications" ON public.notifications;
CREATE POLICY "Users view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users mark own notifications read" ON public.notifications;
CREATE POLICY "Users mark own notifications read" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- REVIEWS: Publicly readable for reputation; customers can create one review per completed booking
DROP POLICY IF EXISTS "Reviews are readable by authenticated users" ON public.reviews;
CREATE POLICY "Reviews are readable by authenticated users" ON public.reviews
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Customers review completed bookings" ON public.reviews;
CREATE POLICY "Customers review completed bookings" ON public.reviews
  FOR INSERT WITH CHECK (
    auth.uid() = customer_id
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = reviews.booking_id
        AND b.customer_id = auth.uid()
        AND b.worker_id = reviews.worker_id
        AND b.booking_status = 'completed'
    )
  );

-- Atomic Offer Acceptance RPC
-- Prevents race conditions or multiple accepted offers for the same job
CREATE OR REPLACE FUNCTION public.accept_worker_offer(
  p_job_id UUID,
  p_offer_id UUID,
  p_customer_id UUID,
  p_deposit_amount INTEGER,
  p_currency TEXT DEFAULT 'ngn'
)
RETURNS TABLE (
  booking_id UUID,
  job_id UUID,
  offer_id UUID,
  worker_id UUID,
  agreed_price INTEGER,
  deposit_amount INTEGER,
  currency TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_offer public.offers%ROWTYPE;
  v_booking_id UUID;
BEGIN
  -- Lock job row
  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  IF v_job.customer_id <> p_customer_id THEN
    RAISE EXCEPTION 'Forbidden: you do not own this job';
  END IF;

  IF v_job.status <> 'open' THEN
    RAISE EXCEPTION 'Job is no longer open for offer acceptance';
  END IF;

  -- Lock target offer row
  SELECT * INTO v_offer
  FROM public.offers
  WHERE id = p_offer_id AND job_id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found for this job';
  END IF;

  IF v_offer.status <> 'pending' THEN
    RAISE EXCEPTION 'Offer is not pending';
  END IF;

  -- Accept chosen offer
  UPDATE public.offers
  SET status = 'accepted'
  WHERE id = p_offer_id;

  -- Reject all other pending offers on this job
  UPDATE public.offers
  SET status = 'rejected'
  WHERE job_id = p_job_id
    AND id <> p_offer_id
    AND status = 'pending';

  -- Mark job assigned
  UPDATE public.jobs
  SET status = 'assigned'
  WHERE id = p_job_id;

  -- Create booking awaiting deposit payment
  INSERT INTO public.bookings (
    job_id, offer_id, customer_id, worker_id, agreed_price, deposit_amount, currency, payment_status, booking_status
  ) VALUES (
    p_job_id, p_offer_id, p_customer_id, v_offer.worker_id, v_offer.proposed_price,
    GREATEST(COALESCE(p_deposit_amount, 2000), 100), LOWER(COALESCE(p_currency, 'ngn')),
    'pending', 'pending_payment'
  )
  RETURNING id INTO v_booking_id;

  -- Notify the selected worker
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_offer.worker_id,
    'Offer accepted',
    format('Your ₦%s offer for "%s" was accepted. Waiting for customer deposit payment to unlock contact details.', v_offer.proposed_price, v_job.title),
    'offer_accepted',
    '/worker/bookings'
  );

  RETURN QUERY SELECT
    v_booking_id,
    p_job_id,
    p_offer_id,
    v_offer.worker_id,
    v_offer.proposed_price,
    GREATEST(COALESCE(p_deposit_amount, 2000), 100),
    LOWER(COALESCE(p_currency, 'ngn'));
END;
$$;

-- Enable Supabase Realtime for notifications
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

-- Storage bucket for optional job reference images & worker avatars
INSERT INTO storage.buckets (id, name, public)
VALUES ('bookam-uploads', 'bookam-uploads', TRUE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read access for bookam uploads" ON storage.objects;
CREATE POLICY "Public read access for bookam uploads" ON storage.objects
  FOR SELECT USING (bucket_id = 'bookam-uploads');

DROP POLICY IF EXISTS "Authenticated users upload to own folder" ON storage.objects;
CREATE POLICY "Authenticated users upload to own folder" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'bookam-uploads'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
