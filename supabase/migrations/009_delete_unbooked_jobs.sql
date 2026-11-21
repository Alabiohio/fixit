CREATE OR REPLACE FUNCTION public.delete_unbooked_customer_job(
  p_job_id UUID,
  p_customer_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
BEGIN
  SELECT *
  INTO v_job
  FROM public.jobs
  WHERE public.jobs.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_job.customer_id <> p_customer_id THEN
    RETURN 'forbidden';
  END IF;

  IF v_job.status NOT IN ('open', 'cancelled') THEN
    RETURN 'job_not_deletable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings
    WHERE public.bookings.job_id = p_job_id
  ) THEN
    RETURN 'has_booking';
  END IF;

  DELETE FROM public.jobs
  WHERE public.jobs.id = p_job_id;

  RETURN 'deleted';
END;
$$;

REVOKE ALL ON FUNCTION public.delete_unbooked_customer_job(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unbooked_customer_job(UUID, UUID)
  TO service_role;
