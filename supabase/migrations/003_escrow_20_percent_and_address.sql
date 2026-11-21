-- Require a 20% escrow deposit based on the accepted offer,
-- and add protected address details to profiles.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';

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
  v_deposit_amount INTEGER;
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
  WHERE id = p_offer_id AND job_id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found for this job';
  END IF;

  IF v_offer.status <> 'pending' THEN
    RAISE EXCEPTION 'Offer is not pending';
  END IF;

  v_deposit_amount := GREATEST(ROUND(v_offer.proposed_price * 0.20), 1);

  UPDATE public.offers
  SET status = 'accepted'
  WHERE id = p_offer_id;

  UPDATE public.offers
  SET status = 'rejected'
  WHERE job_id = p_job_id
    AND id <> p_offer_id
    AND status = 'pending';

  UPDATE public.jobs
  SET status = 'assigned'
  WHERE id = p_job_id;

  INSERT INTO public.bookings (
    job_id, offer_id, customer_id, worker_id, agreed_price,
    deposit_amount, currency, payment_status, booking_status
  ) VALUES (
    p_job_id, p_offer_id, p_customer_id, v_offer.worker_id,
    v_offer.proposed_price, v_deposit_amount,
    LOWER(COALESCE(p_currency, 'ngn')), 'pending', 'pending_payment'
  )
  RETURNING id INTO v_booking_id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_offer.worker_id,
    'Offer accepted',
    format(
      'Your ₦%s offer for "%s" was accepted. The customer must pay a 20%% escrow deposit before contact details are unlocked.',
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
    v_deposit_amount,
    LOWER(COALESCE(p_currency, 'ngn'));
END;
$$;
