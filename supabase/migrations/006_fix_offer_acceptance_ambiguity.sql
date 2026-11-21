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
  WHERE public.jobs.id = p_job_id
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
  WHERE public.jobs.id = p_job_id;

  INSERT INTO public.bookings (
    job_id,
    offer_id,
    customer_id,
    worker_id,
    agreed_price,
    deposit_amount,
    currency,
    payment_status,
    booking_status
  ) VALUES (
    p_job_id,
    p_offer_id,
    p_customer_id,
    v_offer.worker_id,
    v_offer.proposed_price,
    LEAST(
      v_offer.proposed_price,
      GREATEST(COALESCE(p_deposit_amount, ROUND(v_offer.proposed_price * 0.20)::INTEGER), 1)
    ),
    LOWER(COALESCE(p_currency, 'ngn')),
    'pending',
    'pending_payment'
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

REVOKE ALL ON FUNCTION public.accept_worker_offer(UUID, UUID, UUID, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_worker_offer(UUID, UUID, UUID, INTEGER, TEXT)
  TO service_role;
