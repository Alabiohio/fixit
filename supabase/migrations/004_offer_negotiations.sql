ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS negotiation_count INTEGER NOT NULL DEFAULT 0
    CHECK (negotiation_count BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS negotiation_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS negotiation_message TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS negotiation_pending BOOLEAN NOT NULL DEFAULT FALSE;

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
SET search_path = public
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_offer public.offers%ROWTYPE;
  v_booking_id UUID;
BEGIN
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

  SELECT * INTO v_offer
  FROM public.offers
  WHERE public.offers.id = p_offer_id
    AND public.offers.job_id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found for this job';
  END IF;

  IF v_offer.status <> 'pending' THEN
    RAISE EXCEPTION 'Offer is not pending';
  END IF;

  IF v_offer.negotiation_pending AND v_offer.negotiation_by = p_customer_id THEN
    RAISE EXCEPTION 'Wait for the worker to respond to your counteroffer';
  END IF;

  UPDATE public.offers
  SET status = 'accepted'
  WHERE public.offers.id = p_offer_id;

  UPDATE public.offers
  SET status = 'rejected'
  WHERE public.offers.job_id = p_job_id
    AND public.offers.id <> p_offer_id
    AND public.offers.status = 'pending';

  UPDATE public.jobs
  SET status = 'assigned'
  WHERE id = p_job_id;

  INSERT INTO public.bookings (
    job_id, offer_id, customer_id, worker_id, agreed_price,
    deposit_amount, currency, payment_status, booking_status
  ) VALUES (
    p_job_id, p_offer_id, p_customer_id, v_offer.worker_id, v_offer.proposed_price,
    LEAST(
      v_offer.proposed_price,
      GREATEST(COALESCE(p_deposit_amount, ROUND(v_offer.proposed_price * 0.20)::INTEGER), 1)
    ),
    LOWER(COALESCE(p_currency, 'ngn')),
    'pending', 'pending_payment'
  )
  RETURNING id INTO v_booking_id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_offer.worker_id,
    'Offer accepted',
    format(
      'Your ₦%s offer for "%s" was accepted. Waiting for customer deposit payment to unlock contact details.',
      v_offer.proposed_price,
      v_job.title
    ),
    'offer_accepted',
    '/worker/bookings'
  );

  RETURN QUERY SELECT
    v_booking_id,
    p_job_id,
    p_offer_id,
    v_offer.worker_id,
    v_offer.proposed_price,
    LEAST(
      v_offer.proposed_price,
      GREATEST(COALESCE(p_deposit_amount, ROUND(v_offer.proposed_price * 0.20)::INTEGER), 1)
    ),
    LOWER(COALESCE(p_currency, 'ngn'));
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_offer_counteroffer(
  p_offer_id UUID,
  p_actor_id UUID,
  p_proposed_price INTEGER,
  p_message TEXT DEFAULT ''
)
RETURNS public.offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
  v_customer_id UUID;
  v_job_status TEXT;
  v_offer public.offers%ROWTYPE;
BEGIN
  IF p_proposed_price <= 0 THEN
    RAISE EXCEPTION 'Counteroffer price must be greater than zero';
  END IF;

  SELECT job_id INTO v_job_id
  FROM public.offers
  WHERE id = p_offer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;

  SELECT customer_id, status INTO v_customer_id, v_job_status
  FROM public.jobs
  WHERE id = v_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  SELECT * INTO v_offer
  FROM public.offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;

  IF v_job_status <> 'open' OR v_offer.status <> 'pending' THEN
    RAISE EXCEPTION 'This offer is no longer available for negotiation';
  END IF;

  IF p_actor_id <> v_customer_id AND p_actor_id <> v_offer.worker_id THEN
    RAISE EXCEPTION 'Only the customer or worker can negotiate this offer';
  END IF;

  IF v_offer.negotiation_count >= 3 THEN
    RAISE EXCEPTION 'The maximum of three negotiations has been reached';
  END IF;

  IF v_offer.negotiation_pending THEN
    IF v_offer.negotiation_by = p_actor_id THEN
      RAISE EXCEPTION 'Wait for the other participant to respond to your counteroffer';
    END IF;
  ELSIF v_offer.negotiation_count = 0 THEN
    IF p_actor_id <> v_customer_id THEN
      RAISE EXCEPTION 'The customer must start the negotiation';
    END IF;
  ELSE
    RAISE EXCEPTION 'This counteroffer has already been accepted';
  END IF;

  UPDATE public.offers
  SET proposed_price = p_proposed_price,
      negotiation_count = negotiation_count + 1,
      negotiation_by = p_actor_id,
      negotiation_message = COALESCE(p_message, ''),
      negotiation_pending = TRUE
  WHERE id = p_offer_id
  RETURNING * INTO v_offer;

  RETURN v_offer;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_offer_counteroffer(
  p_offer_id UUID,
  p_actor_id UUID
)
RETURNS public.offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
  v_customer_id UUID;
  v_job_status TEXT;
  v_offer public.offers%ROWTYPE;
BEGIN
  SELECT job_id INTO v_job_id
  FROM public.offers
  WHERE id = p_offer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;

  SELECT customer_id, status INTO v_customer_id, v_job_status
  FROM public.jobs
  WHERE id = v_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  SELECT * INTO v_offer
  FROM public.offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;

  IF p_actor_id <> v_offer.worker_id THEN
    RAISE EXCEPTION 'Only the worker can accept the customer counteroffer';
  END IF;

  IF v_job_status <> 'open'
    OR v_offer.status <> 'pending'
    OR NOT v_offer.negotiation_pending
    OR v_offer.negotiation_by IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'There is no customer counteroffer to accept';
  END IF;

  UPDATE public.offers
  SET negotiation_pending = FALSE
  WHERE id = p_offer_id
  RETURNING * INTO v_offer;

  RETURN v_offer;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_worker_offer(
  p_offer_id UUID,
  p_actor_id UUID
)
RETURNS public.offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
  v_customer_id UUID;
  v_job_status TEXT;
  v_offer public.offers%ROWTYPE;
BEGIN
  SELECT job_id INTO v_job_id
  FROM public.offers
  WHERE id = p_offer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;

  SELECT customer_id, status INTO v_customer_id, v_job_status
  FROM public.jobs
  WHERE id = v_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  SELECT * INTO v_offer
  FROM public.offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;

  IF p_actor_id <> v_customer_id AND p_actor_id <> v_offer.worker_id THEN
    RAISE EXCEPTION 'Only the customer or worker can decline this offer';
  END IF;

  IF v_job_status <> 'open' OR v_offer.status <> 'pending' THEN
    RAISE EXCEPTION 'This offer is no longer available to decline';
  END IF;

  UPDATE public.offers
  SET status = 'rejected',
      negotiation_pending = FALSE
  WHERE id = p_offer_id
  RETURNING * INTO v_offer;

  RETURN v_offer;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_offer_counteroffer(UUID, UUID, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_offer_counteroffer(UUID, UUID, INTEGER, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.accept_offer_counteroffer(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_offer_counteroffer(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.decline_worker_offer(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decline_worker_offer(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.accept_worker_offer(UUID, UUID, UUID, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_worker_offer(UUID, UUID, UUID, INTEGER, TEXT)
  TO service_role;
