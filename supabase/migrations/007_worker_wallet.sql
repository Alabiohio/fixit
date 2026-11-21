CREATE TABLE IF NOT EXISTS public.worker_wallets (
  worker_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  available_balance INTEGER NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.worker_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('credit', 'withdrawal')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  reference TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  transfer_code TEXT,
  failure_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_wallet_transactions_booking_credit
  ON public.worker_wallet_transactions (booking_id)
  WHERE transaction_type = 'credit' AND booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_worker_wallet_transactions_worker_created
  ON public.worker_wallet_transactions (worker_id, created_at DESC);

ALTER TABLE public.worker_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_wallet_transactions ENABLE ROW LEVEL SECURITY;

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
  v_platform_fee INTEGER;
  v_credit_amount INTEGER;
  v_transaction_id UUID;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.customer_id <> p_customer_id THEN
    RAISE EXCEPTION 'Only the customer can confirm final job completion';
  END IF;

  IF v_booking.booking_status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled booking cannot be completed';
  END IF;

  IF v_booking.payment_status <> 'paid' OR v_booking.balance_payment_status <> 'paid' THEN
    RAISE EXCEPTION 'The deposit and remaining balance must be paid before completing the booking';
  END IF;

  IF v_booking.booking_status NOT IN ('confirmed', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'This booking is not ready to be completed';
  END IF;

  IF v_booking.booking_status <> 'completed' THEN
    UPDATE public.bookings
    SET booking_status = 'completed'
    WHERE id = p_booking_id
    RETURNING * INTO v_booking;

    UPDATE public.jobs
    SET status = 'completed'
    WHERE id = v_booking.job_id;
  END IF;

  v_platform_fee := ROUND(v_booking.agreed_price * 0.10)::INTEGER;
  v_credit_amount :=
    GREATEST(v_booking.deposit_amount - v_platform_fee, 0)
    + CASE
        WHEN v_booking.balance_payment_method = 'online'
          THEN GREATEST(v_booking.agreed_price - v_booking.deposit_amount, 0)
        ELSE 0
      END;

  IF v_credit_amount > 0 THEN
    INSERT INTO public.worker_wallets (worker_id)
    VALUES (v_booking.worker_id)
    ON CONFLICT (worker_id) DO NOTHING;

    PERFORM 1
    FROM public.worker_wallets
    WHERE public.worker_wallets.worker_id = v_booking.worker_id
    FOR UPDATE;

    INSERT INTO public.worker_wallet_transactions (
      worker_id,
      booking_id,
      transaction_type,
      amount,
      status,
      reference,
      description
    ) VALUES (
      v_booking.worker_id,
      v_booking.id,
      'credit',
      v_credit_amount,
      'completed',
      'booking-credit:' || v_booking.id::TEXT,
      'Completed booking funds after FixIt platform fee'
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_transaction_id;

    IF v_transaction_id IS NOT NULL THEN
      UPDATE public.worker_wallets
      SET available_balance = available_balance + v_credit_amount,
          updated_at = NOW()
      WHERE public.worker_wallets.worker_id = v_booking.worker_id;
    ELSE
      v_credit_amount := 0;
    END IF;
  END IF;

  RETURN QUERY SELECT p_booking_id, v_booking.worker_id, v_credit_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_worker_wallet_withdrawal(
  p_worker_id UUID,
  p_reference TEXT
)
RETURNS TABLE (
  transaction_id UUID,
  worker_id UUID,
  amount INTEGER,
  reference TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.worker_wallets%ROWTYPE;
  v_transaction public.worker_wallet_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_wallet
  FROM public.worker_wallets
  WHERE worker_wallets.worker_id = p_worker_id
  FOR UPDATE;

  IF NOT FOUND OR v_wallet.available_balance <= 0 THEN
    RAISE EXCEPTION 'There is no available wallet balance to withdraw';
  END IF;

  UPDATE public.worker_wallets
  SET available_balance = 0,
      updated_at = NOW()
  WHERE worker_wallets.worker_id = p_worker_id;

  INSERT INTO public.worker_wallet_transactions (
    worker_id,
    transaction_type,
    amount,
    status,
    reference,
    description
  ) VALUES (
    p_worker_id,
    'withdrawal',
    v_wallet.available_balance,
    'pending',
    p_reference,
    'Paystack wallet withdrawal'
  )
  RETURNING * INTO v_transaction;

  RETURN QUERY SELECT
    v_transaction.id,
    v_transaction.worker_id,
    v_transaction.amount,
    v_transaction.reference;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_worker_wallet_withdrawal(
  p_reference TEXT,
  p_status TEXT,
  p_transfer_code TEXT DEFAULT NULL,
  p_failure_reason TEXT DEFAULT '',
  p_allow_reversal BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  worker_id UUID,
  amount INTEGER,
  status TEXT,
  changed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction public.worker_wallet_transactions%ROWTYPE;
BEGIN
  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Invalid wallet withdrawal status';
  END IF;

  SELECT * INTO v_transaction
  FROM public.worker_wallet_transactions
  WHERE reference = p_reference
    AND transaction_type = 'withdrawal'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_status = 'completed' AND v_transaction.status = 'pending' THEN
    UPDATE public.worker_wallet_transactions
    SET status = 'completed',
        transfer_code = COALESCE(p_transfer_code, transfer_code),
        failure_reason = '',
        updated_at = NOW()
    WHERE id = v_transaction.id;

    RETURN QUERY SELECT v_transaction.worker_id, v_transaction.amount, 'completed'::TEXT, TRUE;
    RETURN;
  END IF;

  IF p_status = 'failed'
    AND (
      v_transaction.status = 'pending'
      OR (p_allow_reversal AND v_transaction.status = 'completed')
    ) THEN
    UPDATE public.worker_wallets
    SET available_balance = available_balance + v_transaction.amount,
        updated_at = NOW()
    WHERE worker_wallets.worker_id = v_transaction.worker_id;

    UPDATE public.worker_wallet_transactions
    SET status = 'failed',
        transfer_code = COALESCE(p_transfer_code, transfer_code),
        failure_reason = COALESCE(NULLIF(p_failure_reason, ''), 'Paystack transfer failed.'),
        updated_at = NOW()
    WHERE id = v_transaction.id;

    RETURN QUERY SELECT v_transaction.worker_id, v_transaction.amount, 'failed'::TEXT, TRUE;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_transaction.worker_id,
    v_transaction.amount,
    v_transaction.status,
    FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_booking_and_credit_wallet(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_booking_and_credit_wallet(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.reserve_worker_wallet_withdrawal(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_worker_wallet_withdrawal(UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.finalize_worker_wallet_withdrawal(TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_worker_wallet_withdrawal(TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  TO service_role;
