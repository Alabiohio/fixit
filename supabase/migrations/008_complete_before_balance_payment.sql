CREATE OR REPLACE FUNCTION public.credit_completed_booking_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_platform_fee INTEGER;
  v_credit_amount INTEGER;
  v_transaction_id UUID;
BEGIN
  IF NEW.booking_status <> 'completed'
    OR NEW.payment_status <> 'paid'
    OR NEW.balance_payment_status <> 'paid' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.worker_wallet_transactions
    WHERE public.worker_wallet_transactions.booking_id = NEW.id
      AND public.worker_wallet_transactions.transaction_type = 'credit'
  ) THEN
    RETURN NEW;
  END IF;

  v_platform_fee := ROUND(NEW.agreed_price * 0.10)::INTEGER;
  v_credit_amount :=
    GREATEST(NEW.deposit_amount - v_platform_fee, 0)
    + CASE
        WHEN NEW.balance_payment_method = 'online'
          THEN GREATEST(NEW.agreed_price - NEW.deposit_amount, 0)
        ELSE 0
      END;

  IF v_credit_amount <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.worker_wallets (worker_id)
  VALUES (NEW.worker_id)
  ON CONFLICT (worker_id) DO NOTHING;

  PERFORM 1
  FROM public.worker_wallets
  WHERE public.worker_wallets.worker_id = NEW.worker_id
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
    NEW.worker_id,
    NEW.id,
    'credit',
    v_credit_amount,
    'completed',
    'booking-credit:' || NEW.id::TEXT,
    'Completed booking funds after FixIt platform fee'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_transaction_id;

  IF v_transaction_id IS NOT NULL THEN
    UPDATE public.worker_wallets
    SET available_balance = available_balance + v_credit_amount,
        updated_at = NOW()
    WHERE public.worker_wallets.worker_id = NEW.worker_id;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      NEW.worker_id,
      'Funds added to your FixIt wallet',
      format('₦%s from a completed booking is now available in your wallet.', v_credit_amount),
      'worker_wallet_credit',
      '/worker/balance'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_completed_booking_wallet ON public.bookings;
CREATE TRIGGER credit_completed_booking_wallet
  AFTER INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_completed_booking_wallet();

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

  IF v_booking.booking_status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled booking cannot be completed';
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

REVOKE ALL ON FUNCTION public.credit_completed_booking_wallet()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_booking_and_credit_wallet(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_booking_and_credit_wallet(UUID, UUID)
  TO service_role;
