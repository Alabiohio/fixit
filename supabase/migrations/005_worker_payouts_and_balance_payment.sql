ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS balance_payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (balance_payment_status IN ('unpaid', 'pending', 'reported', 'paid', 'failed', 'not_applicable')),
  ADD COLUMN IF NOT EXISTS balance_payment_method TEXT
    CHECK (balance_payment_method IN ('online', 'in_person')),
  ADD COLUMN IF NOT EXISTS balance_customer_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS balance_worker_confirmed_at TIMESTAMPTZ;

UPDATE public.bookings
SET balance_payment_status = 'not_applicable'
WHERE booking_status = 'completed'
  AND balance_payment_status = 'unpaid';

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'deposit'
    CHECK (payment_type IN ('deposit', 'balance'));

CREATE TABLE IF NOT EXISTS public.worker_payout_accounts (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_code TEXT NOT NULL UNIQUE,
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.worker_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  platform_fee INTEGER NOT NULL CHECK (platform_fee >= 0),
  currency TEXT NOT NULL DEFAULT 'ngn',
  reference TEXT NOT NULL UNIQUE,
  transfer_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  failure_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_payouts_one_pending_per_booking
  ON public.worker_payouts (booking_id)
  WHERE status = 'pending';

ALTER TABLE public.worker_payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_payouts ENABLE ROW LEVEL SECURITY;

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
    OR v_booking.booking_status = 'cancelled'
    OR v_booking.balance_payment_status = 'paid' THEN
    RAISE EXCEPTION 'The remaining balance is not payable';
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
    OR v_booking.booking_status = 'cancelled'
    OR v_booking.agreed_price <= v_booking.deposit_amount THEN
    RAISE EXCEPTION 'The in-person balance cannot be confirmed for this booking';
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

REVOKE ALL ON FUNCTION public.begin_online_balance_payment(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_online_balance_payment(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.confirm_in_person_balance_payment(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_in_person_balance_payment(UUID, UUID)
  TO service_role;
