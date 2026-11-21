ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_booking_status_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_booking_status_check
    CHECK (booking_status IN (
      'pending_payment',
      'confirmed',
      'in_progress',
      'cancellation_pending',
      'completed',
      'cancelled'
    ));

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_balance_payment_status_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_balance_payment_status_check
    CHECK (balance_payment_status IN (
      'unpaid',
      'pending',
      'reported',
      'paid',
      'failed',
      'refunded',
      'not_applicable'
    ));

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stripe_refund_id TEXT;

CREATE TABLE IF NOT EXISTS public.booking_cancellation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES public.profiles(id),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN (
    'pending_review',
    'processing',
    'cancelled',
    'failed',
    'rejected'
  )),
  previous_booking_status TEXT CHECK (previous_booking_status IN (
    'pending_payment',
    'confirmed'
  )),
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_cancellation_active
  ON public.booking_cancellation_requests (booking_id)
  WHERE status IN ('pending_review', 'processing');

CREATE INDEX IF NOT EXISTS idx_booking_cancellation_created
  ON public.booking_cancellation_requests (created_at DESC);

ALTER TABLE public.booking_cancellation_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prevent_booking_progress_during_cancellation_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.booking_status = 'in_progress'
    AND OLD.booking_status <> 'in_progress'
    AND EXISTS (
      SELECT 1
      FROM public.booking_cancellation_requests
      WHERE public.booking_cancellation_requests.booking_id = NEW.id
        AND public.booking_cancellation_requests.status = 'pending_review'
    ) THEN
    RAISE EXCEPTION 'A cancellation request is waiting for manual review';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_booking_progress_during_cancellation_review
  ON public.bookings;
CREATE TRIGGER trg_prevent_booking_progress_during_cancellation_review
  BEFORE UPDATE OF booking_status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_booking_progress_during_cancellation_review();

CREATE OR REPLACE FUNCTION public.begin_booking_cancellation(
  p_booking_id UUID,
  p_actor_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_request public.booking_cancellation_requests%ROWTYPE;
  v_review_required BOOLEAN;
BEGIN
  SELECT *
  INTO v_booking
  FROM public.bookings
  WHERE public.bookings.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  IF p_actor_id <> v_booking.customer_id AND p_actor_id <> v_booking.worker_id THEN
    RETURN jsonb_build_object('result', 'forbidden');
  END IF;

  IF v_booking.booking_status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('result', 'not_cancellable');
  END IF;

  SELECT *
  INTO v_request
  FROM public.booking_cancellation_requests
  WHERE public.booking_cancellation_requests.booking_id = p_booking_id
    AND public.booking_cancellation_requests.status IN ('pending_review', 'processing')
  ORDER BY public.booking_cancellation_requests.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'result', v_request.status,
      'request_id', v_request.id
    );
  END IF;

  v_review_required :=
    v_booking.booking_status = 'in_progress'
    OR (
      v_booking.balance_payment_method = 'in_person'
      AND v_booking.balance_payment_status IN ('reported', 'paid')
    );

  IF v_review_required THEN
    INSERT INTO public.booking_cancellation_requests (
      booking_id,
      requested_by,
      reason,
      status
    )
    VALUES (
      p_booking_id,
      p_actor_id,
      COALESCE(
        NULLIF(p_reason, ''),
        'Manual review is required because an in-person balance was reported or paid.'
      ),
      'pending_review'
    )
    RETURNING * INTO v_request;

    RETURN jsonb_build_object(
      'result', 'pending_review',
      'request_id', v_request.id
    );
  END IF;

  IF v_booking.booking_status NOT IN ('pending_payment', 'confirmed') THEN
    RETURN jsonb_build_object('result', 'not_cancellable');
  END IF;

  INSERT INTO public.booking_cancellation_requests (
    booking_id,
    requested_by,
    reason,
    status,
    previous_booking_status
  )
  VALUES (
    p_booking_id,
    p_actor_id,
    COALESCE(p_reason, ''),
    'processing',
    v_booking.booking_status
  )
  RETURNING * INTO v_request;

  UPDATE public.bookings
  SET booking_status = 'cancellation_pending'
  WHERE public.bookings.id = p_booking_id;

  RETURN jsonb_build_object(
    'result', 'processing',
    'request_id', v_request.id,
    'payment_status', v_booking.payment_status,
    'balance_payment_status', v_booking.balance_payment_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_booking_cancellation(
  p_request_id UUID,
  p_succeeded BOOLEAN,
  p_deposit_refunded BOOLEAN,
  p_balance_refunded BOOLEAN,
  p_review_note TEXT DEFAULT ''
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.booking_cancellation_requests%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT *
  INTO v_request
  FROM public.booking_cancellation_requests
  WHERE public.booking_cancellation_requests.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_request.status = 'cancelled' THEN
    UPDATE public.bookings
    SET payment_status = CASE
          WHEN p_deposit_refunded THEN 'refunded'
          ELSE payment_status
        END,
        balance_payment_status = CASE
          WHEN p_balance_refunded THEN 'refunded'
          ELSE balance_payment_status
        END
    WHERE public.bookings.id = v_request.booking_id;
    RETURN 'already_cancelled';
  END IF;

  IF v_request.status <> 'processing' THEN
    RETURN v_request.status;
  END IF;

  SELECT *
  INTO v_booking
  FROM public.bookings
  WHERE public.bookings.id = v_request.booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'booking_not_found';
  END IF;

  IF p_succeeded THEN
    UPDATE public.bookings
    SET booking_status = 'cancelled',
        payment_status = CASE
          WHEN p_deposit_refunded THEN 'refunded'
          ELSE payment_status
        END,
        balance_payment_status = CASE
          WHEN p_balance_refunded THEN 'refunded'
          ELSE balance_payment_status
        END
    WHERE public.bookings.id = v_booking.id;

    UPDATE public.jobs
    SET status = 'cancelled'
    WHERE public.jobs.id = v_booking.job_id;

    UPDATE public.booking_cancellation_requests
    SET status = 'cancelled',
        review_note = COALESCE(p_review_note, ''),
        updated_at = NOW()
    WHERE public.booking_cancellation_requests.id = p_request_id;

    RETURN 'cancelled';
  END IF;

  UPDATE public.bookings
  SET booking_status = v_request.previous_booking_status
  WHERE public.bookings.id = v_booking.id
    AND public.bookings.booking_status = 'cancellation_pending';

  UPDATE public.booking_cancellation_requests
  SET status = 'failed',
      review_note = COALESCE(p_review_note, ''),
      updated_at = NOW()
  WHERE public.booking_cancellation_requests.id = p_request_id;

  RETURN 'failed';
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_online_balance_payment(
  p_booking_id UUID,
  p_customer_id UUID
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.customer_id <> p_customer_id THEN
    RAISE EXCEPTION 'Only the customer can pay the remaining balance';
  END IF;

  IF v_booking.payment_status <> 'paid'
    OR v_booking.booking_status IN ('cancelled', 'cancellation_pending')
    OR v_booking.balance_payment_status = 'paid' THEN
    RAISE EXCEPTION 'The remaining balance is not payable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_cancellation_requests
    WHERE public.booking_cancellation_requests.booking_id = p_booking_id
      AND public.booking_cancellation_requests.status = 'pending_review'
  ) THEN
    RAISE EXCEPTION 'A cancellation request is waiting for manual review';
  END IF;

  IF v_booking.balance_payment_status = 'pending' THEN
    RAISE EXCEPTION 'An online balance payment is already pending';
  END IF;

  IF v_booking.agreed_price <= v_booking.deposit_amount THEN
    RAISE EXCEPTION 'No remaining balance is due';
  END IF;

  IF v_booking.balance_payment_method = 'in_person' THEN
    RAISE EXCEPTION 'An in-person payment has already been selected';
  END IF;

  UPDATE public.bookings
  SET balance_payment_method = 'online',
      balance_payment_status = 'pending'
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  RETURN v_booking;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_in_person_balance_payment(
  p_booking_id UUID,
  p_actor_id UUID
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_customer_confirmed BOOLEAN;
  v_worker_confirmed BOOLEAN;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF p_actor_id <> v_booking.customer_id AND p_actor_id <> v_booking.worker_id THEN
    RAISE EXCEPTION 'Only booking participants can confirm payment';
  END IF;

  IF v_booking.payment_status <> 'paid'
    OR v_booking.booking_status IN ('cancelled', 'cancellation_pending')
    OR v_booking.agreed_price <= v_booking.deposit_amount THEN
    RAISE EXCEPTION 'The in-person balance cannot be confirmed for this booking';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_cancellation_requests
    WHERE public.booking_cancellation_requests.booking_id = p_booking_id
      AND public.booking_cancellation_requests.status = 'pending_review'
  ) THEN
    RAISE EXCEPTION 'A cancellation request is waiting for manual review';
  END IF;

  IF v_booking.balance_payment_method = 'online' THEN
    RAISE EXCEPTION 'An online payment has already been selected';
  END IF;

  v_customer_confirmed :=
    v_booking.balance_customer_confirmed_at IS NOT NULL OR p_actor_id = v_booking.customer_id;
  v_worker_confirmed :=
    v_booking.balance_worker_confirmed_at IS NOT NULL OR p_actor_id = v_booking.worker_id;

  UPDATE public.bookings
  SET balance_payment_method = 'in_person',
      balance_customer_confirmed_at = CASE
        WHEN p_actor_id = v_booking.customer_id THEN COALESCE(balance_customer_confirmed_at, NOW())
        ELSE balance_customer_confirmed_at
      END,
      balance_worker_confirmed_at = CASE
        WHEN p_actor_id = v_booking.worker_id THEN COALESCE(balance_worker_confirmed_at, NOW())
        ELSE balance_worker_confirmed_at
      END,
      balance_payment_status = CASE
        WHEN v_customer_confirmed AND v_worker_confirmed THEN 'paid'
        ELSE 'reported'
      END
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  RETURN v_booking;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_booking_and_credit_wallet(
  p_booking_id UUID,
  p_customer_id UUID
)
RETURNS TABLE (
  booking_id UUID,
  worker_id UUID,
  credited_amount INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_credited_amount INTEGER := 0;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE public.bookings.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.customer_id <> p_customer_id THEN
    RAISE EXCEPTION 'Only the customer can confirm final job completion';
  END IF;

  IF v_booking.booking_status IN ('cancelled', 'cancellation_pending') THEN
    RAISE EXCEPTION 'A cancelled or cancellation-pending booking cannot be completed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_cancellation_requests
    WHERE public.booking_cancellation_requests.booking_id = p_booking_id
      AND public.booking_cancellation_requests.status = 'pending_review'
  ) THEN
    RAISE EXCEPTION 'A cancellation request is waiting for manual review';
  END IF;

  IF v_booking.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'The booking deposit must be paid before completing the booking';
  END IF;

  IF v_booking.booking_status NOT IN ('confirmed', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'This booking is not ready to be completed';
  END IF;

  IF v_booking.booking_status <> 'completed' THEN
    UPDATE public.bookings
    SET booking_status = 'completed'
    WHERE public.bookings.id = p_booking_id
    RETURNING * INTO v_booking;

    UPDATE public.jobs
    SET status = 'completed'
    WHERE public.jobs.id = v_booking.job_id;
  END IF;

  SELECT COALESCE(
    (
      SELECT public.worker_wallet_transactions.amount
      FROM public.worker_wallet_transactions
      WHERE public.worker_wallet_transactions.booking_id = p_booking_id
        AND public.worker_wallet_transactions.transaction_type = 'credit'
        AND public.worker_wallet_transactions.status = 'completed'
      LIMIT 1
    ),
    0
  )
  INTO v_credited_amount;

  RETURN QUERY SELECT p_booking_id, v_booking.worker_id, v_credited_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_booking_cancellation(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_booking_cancellation(UUID, UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.finish_booking_cancellation(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_booking_cancellation(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.begin_online_balance_payment(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_online_balance_payment(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.confirm_in_person_balance_payment(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_in_person_balance_payment(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_booking_and_credit_wallet(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_booking_and_credit_wallet(UUID, UUID)
  TO service_role;
