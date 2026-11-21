import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CATEGORY_NAMES,
  DEFAULT_LOCAL_PRICING,
  formatNaira,
  SERVICE_CATEGORIES,
  SUPPORTED_CITIES,
  URGENCY_LEVELS,
  type LocalPricingBaseline,
} from '../shared/constants.ts';
import {
  analyzeOffers,
  estimatePrice,
  understandJob,
  validateJob,
  type OfferForAnalysis,
} from './ai.ts';
import {
  getDefaultCurrency,
  getPaystackSecretKey,
  getPublicAppConfig,
} from './config.ts';
import {
  createBalanceCheckoutSession,
  createDepositCheckoutSession,
  handleStripeWebhookEvent,
  getStripeClient,
  refundPaymentIntent,
} from './stripe.ts';
import {
  createPaystackRecipient,
  createPaystackTransfer,
  handlePaystackTransferWebhook,
  listPaystackNigerianBanks,
  PaystackTransportError,
} from './paystack.ts';
import {
  getSupabaseAdmin,
  requireAuth,
  type AuthenticatedRequest,
} from './supabase.ts';

async function loadPricingConfigs(): Promise<LocalPricingBaseline[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return DEFAULT_LOCAL_PRICING;

  const { data, error } = await admin
    .from('pricing_configs')
    .select('city, category, service_type, min_price, max_price, suggested_deposit, currency, is_provisional, notes');

  if (error || !data || data.length === 0) {
    return DEFAULT_LOCAL_PRICING;
  }

  return data.map((row) => ({
    city: row.city,
    category: row.category,
    serviceType: row.service_type,
    minPrice: row.min_price,
    maxPrice: row.max_price,
    suggestedDeposit: row.suggested_deposit,
    currency: row.currency,
    isProvisional: row.is_provisional,
    notes: row.notes,
  }));
}

async function getWorkerStatsMap(workerIds: string[]) {
  const admin = getSupabaseAdmin();
  const stats = new Map<
    string,
    {
      fullName: string;
      avatarUrl: string;
      bio: string;
      serviceCategories: string[];
      serviceLocations: string[];
      availability: string;
      averageRating: number | null;
      reviewCount: number;
      completedJobs: number;
    }
  >();

  if (!admin || workerIds.length === 0) return stats;

  const uniqueIds = Array.from(new Set(workerIds));

  const [{ data: profiles }, { data: workerProfiles }, { data: reviews }, { data: completedBookings }] =
    await Promise.all([
      admin.from('profiles').select('id, full_name, avatar_url').in('id', uniqueIds),
      admin
        .from('worker_profiles')
        .select('user_id, bio, service_categories, service_locations, availability')
        .in('user_id', uniqueIds),
      admin.from('reviews').select('worker_id, rating').in('worker_id', uniqueIds),
      admin
        .from('bookings')
        .select('worker_id')
        .in('worker_id', uniqueIds)
        .eq('booking_status', 'completed'),
    ]);

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  const wpMap = new Map((workerProfiles || []).map((wp) => [wp.user_id, wp]));

  for (const id of uniqueIds) {
    const p = profileMap.get(id);
    const wp = wpMap.get(id);
    const workerReviews = (reviews || []).filter((r) => r.worker_id === id);
    const reviewCount = workerReviews.length;
    const averageRating =
      reviewCount > 0
        ? Number(
            (
              workerReviews.reduce((acc, r) => acc + Number(r.rating), 0) /
              reviewCount
            ).toFixed(1),
          )
        : null;
    const completedJobs = (completedBookings || []).filter((b) => b.worker_id === id).length;

    stats.set(id, {
      fullName: p?.full_name || 'FixIt Professional',
      avatarUrl: p?.avatar_url || '',
      bio: wp?.bio || '',
      serviceCategories: wp?.service_categories || [],
      serviceLocations: wp?.service_locations || [],
      availability: wp?.availability || 'Available this week',
      averageRating,
      reviewCount,
      completedJobs,
    });
  }

  return stats;
}

export function registerRoutes(app: Express): void {
  // Stripe Webhook MUST receive raw Buffer BEFORE express.json()
  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) {
        res.status(503).json({ error: 'Supabase is not configured' });
        return;
      }

      const signature = req.headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
      }

      try {
        const result = await handleStripeWebhookEvent(
          req.body as Buffer,
          signature,
          admin,
        );
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Webhook verification failed';
        console.error('[FixIt Stripe Webhook Error]', message);
        res.status(400).json({ error: message });
      }
    },
  );

  app.post(
    '/api/paystack/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) {
        res.status(503).json({ error: 'Supabase is not configured.' });
        return;
      }

      const signature = req.headers['x-paystack-signature'];
      if (!signature || typeof signature !== 'string') {
        res.status(400).json({ error: 'Missing x-paystack-signature header.' });
        return;
      }

      try {
        const result = await handlePaystackTransferWebhook(
          req.body as Buffer,
          signature,
          admin,
        );
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Paystack webhook verification failed.';
        console.error('[FixIt Paystack Webhook Error]', message);
        res.status(400).json({ error: message });
      }
    },
  );

  // JSON body parser for all other API routes
  app.use('/api', express.json({ limit: '5mb' }));

  // Health & public config
  app.get('/api/health', (_req, res) => {
    const cfg = getPublicAppConfig();
    res.json({ ok: true, configuredServices: cfg.configuredServices });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      ...getPublicAppConfig(),
      cities: SUPPORTED_CITIES,
      categories: SERVICE_CATEGORIES,
      urgencyLevels: URGENCY_LEVELS,
    });
  });

  app.get('/api/pricing-configs', async (_req, res) => {
    const configs = await loadPricingConfigs();
    res.json({ configs });
  });

  // ============================================================================
  // AI ENDPOINTS (Server-side Groq only)
  // ============================================================================
  app.post('/api/ai/analyze-request', async (req, res) => {
    const parsed = z.object({ description: z.string().max(3000) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please provide a valid job description.' });
      return;
    }

    const { description } = parsed.data;
    const validation = await validateJob(description);

    if (!validation.valid) {
      res.json({
        validation,
        understood: null,
        estimate: null,
      });
      return;
    }

    try {
      const understood = await understandJob(description);
      const configs = await loadPricingConfigs();
      const estimate = await estimatePrice(
        {
          category: understood.category,
          title: understood.title,
          description,
          serviceType: understood.serviceType,
          location: understood.location,
          urgency: understood.urgency,
        },
        configs,
      );

      res.json({
        validation,
        understood,
        estimate,
      });
    } catch (err) {
      console.error('[FixIt AI analyze-request fallback]', err);
      res.json({
        validation: {
          valid: false,
          status: 'ai_unavailable',
          message:
            "We couldn't confidently understand this request. Please provide more details or select a service category manually.",
          suggestions: ['Select a service category and neighborhood manually below.'],
          allowManual: true,
        },
        understood: null,
        estimate: null,
      });
    }
  });

  app.post('/api/ai/estimate', async (req, res) => {
    const schema = z.object({
      category: z.string().min(2),
      title: z.string().min(2),
      description: z.string().min(2),
      serviceType: z.string().optional(),
      location: z.string().optional(),
      urgency: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid job details for price estimation.' });
      return;
    }
    const configs = await loadPricingConfigs();
    const estimate = await estimatePrice(parsed.data, configs);
    res.json({ estimate });
  });

  app.post('/api/ai/analyze-offers', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({ jobId: z.string().uuid() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid jobId is required.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;

    const { data: job, error: jobErr } = await admin
      .from('jobs')
      .select('*')
      .eq('id', parsed.data.jobId)
      .maybeSingle();

    if (jobErr || !job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    if (job.customer_id !== userId) {
      res.status(403).json({ error: 'You do not have permission to analyze offers for this job.' });
      return;
    }

    const { data: offers } = await admin
      .from('offers')
      .select('*')
      .eq('job_id', job.id)
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false });

    const workerIds = (offers || []).map((o) => o.worker_id);
    const statsMap = await getWorkerStatsMap(workerIds);

    const formattedOffers: OfferForAnalysis[] = (offers || []).map((o) => {
      const ws = statsMap.get(o.worker_id);
      return {
        id: o.id,
        workerName: ws?.fullName || 'Worker',
        proposedPrice: o.proposed_price,
        estimatedCompletion: o.estimated_completion,
        availability: o.availability,
        message: o.message || '',
        averageRating: ws?.averageRating ?? null,
        completedJobs: ws?.completedJobs ?? 0,
      };
    });

    const analysis = await analyzeOffers(
      {
        title: job.title,
        category: job.category,
        location: job.location,
        estimatedMin: job.estimated_min,
        estimatedMax: job.estimated_max,
        budget: job.budget,
      },
      formattedOffers,
    );

    res.json({ analysis });
  });

  // ============================================================================
  // PROFILE & WORKER PROFILE ENDPOINTS
  // ============================================================================
  app.get('/api/me', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const user = req.authUser!;

    let { data: profile } = await admin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      const { data: inserted } = await admin
        .from('profiles')
        .insert({
          id: user.id,
          full_name: (user.user_metadata?.full_name as string) || '',
          email: user.email || '',
          phone_number: (user.user_metadata?.phone_number as string) || '',
          avatar_url: (user.user_metadata?.avatar_url as string) || '',
        })
        .select('*')
        .single();
      profile = inserted;
    }

    const { data: workerProfile } = await admin
      .from('worker_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    const statsMap = await getWorkerStatsMap([user.id]);
    const workerStats = statsMap.get(user.id);

    res.json({
      profile,
      workerProfile,
      workerStats: workerStats
        ? {
            averageRating: workerStats.averageRating,
            reviewCount: workerStats.reviewCount,
            completedJobs: workerStats.completedJobs,
          }
        : { averageRating: null, reviewCount: 0, completedJobs: 0 },
    });
  });

  app.patch('/api/me', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      full_name: z.string().trim().min(2).max(120),
      phone_number: z.string().trim().min(7).max(30),
      avatar_url: z.string().max(1000).optional().default(''),
      city: z.string().trim().min(2).max(80).optional().default('Benin City'),
      address: z.string().trim().max(240).optional().default(''),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid profile fields.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const user = req.authUser!;

    const { data, error } = await admin
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email || '',
        ...parsed.data,
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ profile: data });
  });

  app.put('/api/worker/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      full_name: z.string().trim().min(2).max(120).optional(),
      phone_number: z.string().trim().min(7).max(30).optional(),
      avatar_url: z.string().max(1000).optional(),
      address: z.string().trim().max(240).optional(),
      bio: z.string().trim().min(10).max(1000),
      service_categories: z.array(z.string()).min(1),
      service_locations: z.array(z.string()).min(1),
      availability: z.string().trim().min(3).max(120),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid worker profile fields.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const user = req.authUser!;

    if (parsed.data.full_name || parsed.data.phone_number || parsed.data.avatar_url !== undefined || parsed.data.address !== undefined) {
      const profileUpdate: Record<string, string> = {};
      if (parsed.data.full_name) profileUpdate.full_name = parsed.data.full_name;
      if (parsed.data.phone_number) profileUpdate.phone_number = parsed.data.phone_number;
      if (parsed.data.avatar_url !== undefined) profileUpdate.avatar_url = parsed.data.avatar_url;
      if (parsed.data.address !== undefined) profileUpdate.address = parsed.data.address;

      await admin
        .from('profiles')
        .upsert({ id: user.id, email: user.email || '', ...profileUpdate });
    }

    const { data, error } = await admin
      .from('worker_profiles')
      .upsert(
        {
          user_id: user.id,
          bio: parsed.data.bio,
          service_categories: parsed.data.service_categories,
          service_locations: parsed.data.service_locations,
          availability: parsed.data.availability,
        },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ workerProfile: data });
  });

  // ============================================================================
  // JOBS ENDPOINTS
  // ============================================================================
  app.post('/api/jobs', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      title: z.string().trim().min(3).max(160),
      description: z.string().trim().min(8).max(3000),
      category: z.enum(CATEGORY_NAMES as [string, ...string[]]),
      city: z.string().trim().min(2).max(80).default('Benin City'),
      location: z.string().trim().min(2).max(120),
      budget: z.number().int().positive().nullable().optional(),
      estimated_min: z.number().int().nonnegative().nullable().optional(),
      estimated_max: z.number().int().nonnegative().nullable().optional(),
      suggested_deposit: z.number().int().nonnegative().nullable().optional(),
      estimate_explanation: z.string().max(1500).optional().default(''),
      estimate_assumptions: z.array(z.string()).optional().default([]),
      estimate_is_provisional: z.boolean().optional().default(true),
      urgency: z.enum(URGENCY_LEVELS).default('Medium'),
      reference_image_url: z.string().max(1000).optional().default(''),
      additional_questions: z.array(z.string()).optional().default([]),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid job submission.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const user = req.authUser!;

    const { data, error } = await admin
      .from('jobs')
      .insert({
        customer_id: user.id,
        ...parsed.data,
        status: 'open',
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({ job: data });
  });

  app.get('/api/jobs/my', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;

    const { data: jobs, error } = await admin
      .from('jobs')
      .select('*')
      .eq('customer_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const jobIds = (jobs || []).map((j) => j.id);
    const { data: offers } =
      jobIds.length > 0
        ? await admin
            .from('offers')
            .select('id, job_id, status')
            .in('job_id', jobIds)
        : { data: [] };

    const enriched = (jobs || []).map((j) => {
      const jobOffers = (offers || []).filter((o) => o.job_id === j.id && o.status !== 'withdrawn');
      return {
        ...j,
        offer_count: jobOffers.length,
        pending_offer_count: jobOffers.filter((o) => o.status === 'pending').length,
      };
    });

    res.json({ jobs: enriched });
  });

  app.get('/api/jobs/board', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const location = typeof req.query.location === 'string' ? req.query.location.trim() : '';

    let query = admin
      .from('jobs')
      .select(
        'id, customer_id, title, description, category, city, location, budget, estimated_min, estimated_max, suggested_deposit, estimate_explanation, estimate_is_provisional, urgency, reference_image_url, status, created_at',
      )
      .eq('status', 'open')
      .neq('customer_id', userId)
      .order('created_at', { ascending: false });

    if (category && category !== 'All') {
      query = query.eq('category', category);
    }
    if (location && location !== 'All') {
      query = query.ilike('location', `%${location}%`);
    }

    const { data: jobs, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const jobIds = (jobs || []).map((j) => j.id);
    const customerIds = (jobs || []).map((j) => j.customer_id);

    const [{ data: offers }, { data: customerProfiles }] = await Promise.all([
      jobIds.length > 0
        ? admin.from('offers').select('id, job_id, worker_id, status').in('job_id', jobIds)
        : Promise.resolve({ data: [] }),
      customerIds.length > 0
        ? admin.from('profiles').select('id, full_name').in('id', Array.from(new Set(customerIds)))
        : Promise.resolve({ data: [] }),
    ]);

    const customerMap = new Map((customerProfiles || []).map((c) => [c.id, c.full_name || 'Customer']));

    // NEVER return customer phone_number or email
    const boardJobs = (jobs || []).map((j) => {
      const jobOffers = (offers || []).filter((o) => o.job_id === j.id && o.status !== 'withdrawn');
      const myOffer = jobOffers.find((o) => o.worker_id === userId && o.status !== 'withdrawn');
      return {
        id: j.id,
        title: j.title,
        description: j.description,
        category: j.category,
        city: j.city,
        location: j.location,
        budget: j.budget,
        estimated_min: j.estimated_min,
        estimated_max: j.estimated_max,
        suggested_deposit: j.suggested_deposit,
        estimate_explanation: j.estimate_explanation,
        estimate_is_provisional: j.estimate_is_provisional,
        urgency: j.urgency,
        reference_image_url: j.reference_image_url,
        status: j.status,
        created_at: j.created_at,
        customer_name: customerMap.get(j.customer_id) || 'Customer',
        offer_count: jobOffers.length,
        has_my_offer: Boolean(myOffer),
        my_offer_status: myOffer?.status || null,
      };
    });

    res.json({ jobs: boardJobs });
  });

  app.get('/api/jobs/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;
    const jobId = req.params.id;

    const { data: job, error } = await admin
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();

    if (error || !job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    const isOwner = job.customer_id === userId;

    // Fetch offers
    let offersQuery = admin
      .from('offers')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });

    if (!isOwner) {
      offersQuery = offersQuery.eq('worker_id', userId);
    }

    const { data: rawOffers } = await offersQuery;
    const offers = rawOffers || [];

    const { data: customerProfile } = await admin
      .from('profiles')
      .select('id, full_name, avatar_url')
      .eq('id', job.customer_id)
      .maybeSingle();

    let enrichedOffers = offers;
    if (isOwner && offers.length > 0) {
      const statsMap = await getWorkerStatsMap(offers.map((o) => o.worker_id));
      enrichedOffers = offers.map((o) => {
        const ws = statsMap.get(o.worker_id);
        return {
          ...o,
          worker: {
            id: o.worker_id,
            full_name: ws?.fullName || 'FixIt Professional',
            avatar_url: ws?.avatarUrl || '',
            bio: ws?.bio || '',
            service_categories: ws?.serviceCategories || [],
            service_locations: ws?.serviceLocations || [],
            availability: ws?.availability || '',
            average_rating: ws?.averageRating ?? null,
            review_count: ws?.reviewCount ?? 0,
            completed_jobs: ws?.completedJobs ?? 0,
          },
        };
      });
    }

    const { data: booking } = await admin
      .from('bookings')
      .select('id, job_id, offer_id, customer_id, worker_id, agreed_price, deposit_amount, currency, payment_status, balance_payment_status, balance_payment_method, balance_customer_confirmed_at, balance_worker_confirmed_at, booking_status, created_at')
      .eq('job_id', jobId)
      .maybeSingle();

    if (!isOwner && job.status !== 'open' && offers.length === 0 && booking?.worker_id !== userId) {
      res.status(403).json({ error: 'This job is no longer available.' });
      return;
    }

    const { count: totalOfferCount } = await admin
      .from('offers')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .neq('status', 'withdrawn');

    // Never return customer phone_number or email in job details
    res.json({
      job: {
        ...job,
        customer_name: customerProfile?.full_name || 'Customer',
        offer_count: totalOfferCount || 0,
      },
      isOwner,
      offers: enrichedOffers,
      booking: booking && (booking.customer_id === userId || booking.worker_id === userId) ? booking : null,
    });
  });

  app.patch('/api/jobs/:id/cancel', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;
    const jobId = req.params.id;

    const { data: job } = await admin.from('jobs').select('*').eq('id', jobId).maybeSingle();
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (job.customer_id !== userId) {
      res.status(403).json({ error: 'Only the job owner can cancel this job.' });
      return;
    }
    if (job.status !== 'open') {
      res.status(400).json({ error: 'Only open jobs without an active booking can be cancelled.' });
      return;
    }

    const { data: updated, error } = await admin
      .from('jobs')
      .update({ status: 'cancelled' })
      .eq('id', jobId)
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await admin
      .from('offers')
      .update({ status: 'expired' })
      .eq('job_id', jobId)
      .eq('status', 'pending');

    res.json({ job: updated });
  });

  app.delete('/api/jobs/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const parsedJobId = z.string().uuid().safeParse(req.params.id);
    if (!parsedJobId.success) {
      res.status(400).json({ error: 'A valid job ID is required.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const { data: result, error } = await admin.rpc('delete_unbooked_customer_job', {
      p_job_id: parsedJobId.data,
      p_customer_id: req.authUser!.id,
    });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    if (result === 'not_found') {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (result === 'forbidden') {
      res.status(403).json({ error: 'Only the job owner can delete this job.' });
      return;
    }
    if (result === 'job_not_deletable') {
      res.status(409).json({ error: 'Only open or cancelled jobs can be deleted.' });
      return;
    }
    if (result === 'has_booking') {
      res.status(409).json({ error: 'Jobs with booking history cannot be deleted.' });
      return;
    }
    if (result !== 'deleted') {
      res.status(500).json({ error: 'Unable to delete job.' });
      return;
    }

    res.json({ success: true });
  });

  // ============================================================================
  // OFFERS ENDPOINTS
  // ============================================================================
  app.post('/api/offers', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      job_id: z.string().uuid(),
      proposed_price: z.number().int().positive().max(50000000),
      estimated_completion: z.string().trim().min(2).max(120),
      availability: z.string().trim().min(2).max(120),
      message: z.string().trim().max(1000).optional().default(''),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid offer details.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const workerId = req.authUser!.id;

    const { data: job } = await admin
      .from('jobs')
      .select('id, title, customer_id, status')
      .eq('id', parsed.data.job_id)
      .maybeSingle();

    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    if (job.status !== 'open') {
      res.status(400).json({ error: 'This job is no longer accepting offers.' });
      return;
    }

    if (job.customer_id === workerId) {
      res.status(400).json({ error: 'You cannot submit an offer on your own job.' });
      return;
    }

    // Ensure worker has a profile record
    const { data: wp } = await admin
      .from('worker_profiles')
      .select('id')
      .eq('user_id', workerId)
      .maybeSingle();

    if (!wp) {
      res.status(400).json({
        error: 'Please complete your Worker Profile before submitting offers.',
        code: 'WORKER_PROFILE_REQUIRED',
      });
      return;
    }

    const { data: existingOffer } = await admin
      .from('offers')
      .select('id, status')
      .eq('job_id', job.id)
      .eq('worker_id', workerId)
      .in('status', ['pending', 'accepted'])
      .maybeSingle();

    if (existingOffer) {
      res.status(409).json({ error: 'You already have an active offer on this job.' });
      return;
    }

    const { data: offer, error } = await admin
      .from('offers')
      .insert({
        job_id: job.id,
        worker_id: workerId,
        proposed_price: parsed.data.proposed_price,
        estimated_completion: parsed.data.estimated_completion,
        availability: parsed.data.availability,
        message: parsed.data.message,
        status: 'pending',
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const { data: workerProfile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', workerId)
      .maybeSingle();

    const workerName = workerProfile?.full_name || 'A professional';

    await admin.from('notifications').insert({
      user_id: job.customer_id,
      title: 'New offer received',
      message: `${workerName} submitted a ₦${parsed.data.proposed_price.toLocaleString('en-NG')} offer for "${job.title}".`,
      type: 'new_offer',
      link: `/customer/jobs/${job.id}`,
    });

    res.status(201).json({ offer });
  });

  app.get('/api/offers/my', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const workerId = req.authUser!.id;

    const { data: offers, error } = await admin
      .from('offers')
      .select('*')
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const jobIds = Array.from(new Set((offers || []).map((o) => o.job_id)));
    const { data: jobs } =
      jobIds.length > 0
        ? await admin
            .from('jobs')
            .select('id, title, category, location, urgency, status, budget, estimated_min, estimated_max')
            .in('id', jobIds)
        : { data: [] };

    const jobMap = new Map((jobs || []).map((j) => [j.id, j]));

    const enriched = (offers || []).map((o) => ({
      ...o,
      job: jobMap.get(o.job_id) || null,
    }));

    res.json({ offers: enriched });
  });

  app.patch('/api/offers/:id/withdraw', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const workerId = req.authUser!.id;
    const offerId = req.params.id;

    const { data: offer } = await admin.from('offers').select('*').eq('id', offerId).maybeSingle();
    if (!offer) {
      res.status(404).json({ error: 'Offer not found.' });
      return;
    }
    if (offer.worker_id !== workerId) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }
    if (offer.status !== 'pending') {
      res.status(400).json({ error: 'Only pending offers can be withdrawn.' });
      return;
    }

    const { data: updated, error } = await admin
      .from('offers')
      .update({ status: 'withdrawn' })
      .eq('id', offerId)
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ offer: updated });
  });

  app.post('/api/offers/:id/negotiate', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      proposed_price: z.number().int().positive().max(50000000),
      message: z.string().trim().max(1000).optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid counteroffer.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const actorId = req.authUser!.id;
    const { data, error } = await admin.rpc('submit_offer_counteroffer', {
      p_offer_id: req.params.id,
      p_actor_id: actorId,
      p_proposed_price: parsed.data.proposed_price,
      p_message: parsed.data.message,
    });
    const offer = Array.isArray(data) ? data[0] : data;

    if (error || !offer) {
      res.status(400).json({ error: error?.message || 'Unable to submit counteroffer.' });
      return;
    }

    const { data: job } = await admin
      .from('jobs')
      .select('title, customer_id')
      .eq('id', offer.job_id)
      .maybeSingle();
    const recipientId = actorId === job?.customer_id ? offer.worker_id : job?.customer_id;

    if (recipientId) {
      await admin.from('notifications').insert({
        user_id: recipientId,
        title: 'Counteroffer received',
        message: `A new ₦${parsed.data.proposed_price.toLocaleString('en-NG')} counteroffer was sent for "${job?.title || 'a job'}".`,
        type: 'offer_negotiation',
        link: actorId === job?.customer_id ? '/worker/offers' : `/customer/jobs/${offer.job_id}`,
      });
    }

    res.json({ offer });
  });

  app.post('/api/offers/:id/accept-counteroffer', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const actorId = req.authUser!.id;
    const { data, error } = await admin.rpc('accept_offer_counteroffer', {
      p_offer_id: req.params.id,
      p_actor_id: actorId,
    });
    const offer = Array.isArray(data) ? data[0] : data;

    if (error || !offer) {
      res.status(400).json({ error: error?.message || 'Unable to accept counteroffer.' });
      return;
    }

    const { data: job } = await admin
      .from('jobs')
      .select('title, customer_id')
      .eq('id', offer.job_id)
      .maybeSingle();
    if (job?.customer_id) {
      await admin.from('notifications').insert({
        user_id: job.customer_id,
        title: 'Counteroffer accepted',
        message: `The worker accepted your ₦${offer.proposed_price.toLocaleString('en-NG')} counteroffer for "${job.title}".`,
        type: 'offer_negotiation',
        link: `/customer/jobs/${offer.job_id}`,
      });
    }

    res.json({ offer });
  });

  app.post('/api/offers/:id/decline', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const actorId = req.authUser!.id;
    const { data, error } = await admin.rpc('decline_worker_offer', {
      p_offer_id: req.params.id,
      p_actor_id: actorId,
    });
    const offer = Array.isArray(data) ? data[0] : data;

    if (error || !offer) {
      res.status(400).json({ error: error?.message || 'Unable to decline offer.' });
      return;
    }

    const { data: job } = await admin
      .from('jobs')
      .select('title, customer_id')
      .eq('id', offer.job_id)
      .maybeSingle();
    const recipientId = actorId === job?.customer_id ? offer.worker_id : job?.customer_id;

    if (recipientId) {
      await admin.from('notifications').insert({
        user_id: recipientId,
        title: 'Offer declined',
        message: `The offer for "${job?.title || 'a job'}" was declined.`,
        type: 'offer_declined',
        link: actorId === job?.customer_id ? '/worker/offers' : `/customer/jobs/${offer.job_id}`,
      });
    }

    res.json({ offer });
  });

  // Atomic Offer Acceptance
  app.post('/api/jobs/:id/accept-offer', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({ offerId: z.string().uuid() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid offerId is required.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const customerId = req.authUser!.id;
    const jobId = req.params.id;

    const { data: job } = await admin
      .from('jobs')
      .select('id, customer_id')
      .eq('id', jobId)
      .maybeSingle();

    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (job.customer_id !== customerId) {
      res.status(403).json({ error: 'Only the job owner can accept an offer.' });
      return;
    }

    const { data: offer } = await admin
      .from('offers')
      .select('id, proposed_price, status, negotiation_by, negotiation_pending')
      .eq('id', parsed.data.offerId)
      .eq('job_id', jobId)
      .maybeSingle();

    if (!offer) {
      res.status(404).json({ error: 'Offer not found.' });
      return;
    }

    if (offer.status !== 'pending') {
      res.status(400).json({ error: 'This offer is no longer available.' });
      return;
    }
    if (offer.negotiation_pending && offer.negotiation_by === customerId) {
      res.status(400).json({ error: 'Wait for the worker to respond to your counteroffer.' });
      return;
    }

    const depositAmount = Math.min(
      Number(offer.proposed_price),
      Math.max(Math.round(Number(offer.proposed_price) * 0.20), 1),
    );
    const currency = getDefaultCurrency();

    const { data, error } = await admin.rpc('accept_worker_offer', {
      p_job_id: jobId,
      p_offer_id: parsed.data.offerId,
      p_customer_id: customerId,
      p_deposit_amount: depositAmount,
      p_currency: currency,
    });

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    const created = Array.isArray(data) ? data[0] : data;
    res.status(201).json({ booking: created });
  });

  // ============================================================================
  // BOOKINGS & STRICT CONTACT PROTECTION ENDPOINTS
  // ============================================================================
  app.get('/api/paystack/banks', requireAuth, async (_req: AuthenticatedRequest, res) => {
    try {
      res.json({ banks: await listPaystackNigerianBanks() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to load Nigerian banks.';
      res.status(message === 'PAYSTACK_NOT_CONFIGURED' ? 503 : 502).json({ error: message });
    }
  });

  app.get('/api/payouts/paystack-account', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;
    const { data: account, error } = await admin
      .from('worker_payout_accounts')
      .select('bank_name, account_name, account_last4')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({
      configured: Boolean(getPaystackSecretKey()),
      account: account || null,
    });
  });

  app.put('/api/payouts/paystack-account', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      account_number: z.string().regex(/^\d{10}$/, 'Enter a valid 10-digit Nigerian account number.'),
      bank_code: z.string().trim().min(1).max(32),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid bank account details.' });
      return;
    }
    if (!getPaystackSecretKey()) {
      res.status(503).json({ error: 'Paystack transfers are not configured on the server.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    try {
      const recipient = await createPaystackRecipient({
        accountNumber: parsed.data.account_number,
        bankCode: parsed.data.bank_code,
      });
      const { error } = await admin.from('worker_payout_accounts').upsert(
        {
          user_id: req.authUser!.id,
          recipient_code: recipient.recipientCode,
          bank_code: recipient.bankCode,
          bank_name: recipient.bankName,
          account_name: recipient.accountName,
          account_last4: recipient.accountLast4,
        },
        { onConflict: 'user_id' },
      );

      if (error) {
        res.status(500).json({ error: `Could not save payout account: ${error.message}` });
        return;
      }

      res.json({
        account: {
          bank_name: recipient.bankName,
          account_name: recipient.accountName,
          account_last4: recipient.accountLast4,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to verify payout account.';
      res.status(message === 'PAYSTACK_NOT_CONFIGURED' ? 503 : 400).json({ error: message });
    }
  });

  app.get('/api/worker/wallet', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const workerId = req.authUser!.id;
    const [{ data: wallet, error: walletError }, { data: transactions, error: transactionsError }] =
      await Promise.all([
        admin
          .from('worker_wallets')
          .select('worker_id, available_balance, updated_at')
          .eq('worker_id', workerId)
          .maybeSingle(),
        admin
          .from('worker_wallet_transactions')
          .select('id, booking_id, transaction_type, amount, status, reference, description, transfer_code, failure_reason, created_at')
          .eq('worker_id', workerId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

    if (walletError || transactionsError) {
      res.status(500).json({ error: walletError?.message || transactionsError?.message });
      return;
    }

    res.json({
      wallet: wallet || { worker_id: workerId, available_balance: 0, updated_at: null },
      transactions: transactions || [],
    });
  });

  app.post('/api/worker/wallet/withdraw', requireAuth, async (req: AuthenticatedRequest, res) => {
    if (!getPaystackSecretKey()) {
      res.status(503).json({ error: 'Paystack transfers are not configured on the server.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const workerId = req.authUser!.id;
    const { data: payoutAccount, error: accountError } = await admin
      .from('worker_payout_accounts')
      .select('recipient_code')
      .eq('user_id', workerId)
      .maybeSingle();

    if (accountError || !payoutAccount) {
      res.status(400).json({
        error: accountError?.message || 'Add and verify your Paystack bank account before withdrawing.',
      });
      return;
    }

    const reference = `fixit-wallet-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const { data: reservation, error: reservationError } = await admin.rpc(
      'reserve_worker_wallet_withdrawal',
      {
        p_worker_id: workerId,
        p_reference: reference,
      },
    );
    if (reservationError) {
      res.status(400).json({ error: reservationError.message });
      return;
    }

    const withdrawal = Array.isArray(reservation) ? reservation[0] : reservation;
    if (!withdrawal?.amount) {
      res.status(500).json({ error: 'Wallet withdrawal was not reserved.' });
      return;
    }

    try {
      const transfer = await createPaystackTransfer({
        amountNgn: Number(withdrawal.amount),
        recipientCode: payoutAccount.recipient_code,
        reference,
        reason: `FixIt wallet withdrawal for worker ${workerId}`,
      });

      const transferStatus = transfer.status.toLowerCase();
      if (transferStatus === 'success' || transferStatus === 'failed') {
        const { error: finalizeError } = await admin.rpc('finalize_worker_wallet_withdrawal', {
          p_reference: reference,
          p_status: transferStatus === 'success' ? 'completed' : 'failed',
          p_transfer_code: transfer.transfer_code || null,
          p_failure_reason: transferStatus === 'failed' ? 'Paystack transfer failed.' : '',
          p_allow_reversal: false,
        });
        if (finalizeError) {
          res.status(500).json({
            error: `Paystack responded, but FixIt could not update the wallet withdrawal. Reference: ${reference}`,
          });
          return;
        }
      } else {
        const requiresOtp = transferStatus === 'otp';
        const { error: transferUpdateError } = await admin
          .from('worker_wallet_transactions')
          .update({
            transfer_code: transfer.transfer_code || null,
            failure_reason: requiresOtp
              ? 'Paystack requires an administrator to approve this transfer from the Paystack dashboard.'
              : '',
          })
          .eq('reference', reference)
          .eq('status', 'pending');
        if (transferUpdateError) {
          res.status(500).json({
            error: `Paystack started the transfer, but FixIt could not save its status. Reference: ${reference}`,
          });
          return;
        }
      }

      const { data: savedWithdrawal, error: withdrawalReadError } = await admin
        .from('worker_wallet_transactions')
        .select('id, booking_id, transaction_type, amount, status, reference, description, transfer_code, failure_reason, created_at')
        .eq('reference', reference)
        .single();
      if (withdrawalReadError) {
        res.status(500).json({ error: withdrawalReadError.message });
        return;
      }

      if (savedWithdrawal.status === 'failed') {
        res.status(502).json({
          error: savedWithdrawal.failure_reason || 'Paystack transfer failed; funds were returned to your wallet.',
          withdrawal: savedWithdrawal,
        });
        return;
      }
      res.json({ withdrawal: savedWithdrawal });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Paystack withdrawal could not be started.';
      if (err instanceof PaystackTransportError) {
        const { error: recordError } = await admin
          .from('worker_wallet_transactions')
          .update({ failure_reason: message })
          .eq('reference', reference)
          .eq('status', 'pending');
        if (recordError) {
          res.status(500).json({
            error: `Transfer status is unknown and could not be recorded. Verify it in Paystack before retrying. Reference: ${reference}`,
          });
          return;
        }
        res.status(202).json({
          withdrawal: { ...withdrawal, failure_reason: message },
          warning: 'Do not retry until this transfer is checked in Paystack.',
        });
        return;
      }

      const { error: refundError } = await admin.rpc('finalize_worker_wallet_withdrawal', {
        p_reference: reference,
        p_status: 'failed',
        p_failure_reason: message,
        p_allow_reversal: false,
      });
      if (refundError) {
        res.status(500).json({
          error: `Paystack rejected the transfer and the wallet refund could not be recorded. Contact FixIt support. Reference: ${reference}`,
        });
        return;
      }
      res.status(message === 'PAYSTACK_NOT_CONFIGURED' ? 503 : 502).json({ error: message });
    }
  });

  app.get('/api/bookings/my', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;
    const role = req.query.role === 'worker' ? 'worker' : 'customer';

    const column = role === 'worker' ? 'worker_id' : 'customer_id';
    const { data: bookings, error } = await admin
      .from('bookings')
      .select('*')
      .eq(column, userId)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const bookingRows = bookings || [];
    const jobIds = Array.from(new Set(bookingRows.map((b) => b.job_id)));
    const counterpartIds = Array.from(
      new Set(bookingRows.map((b) => (role === 'worker' ? b.customer_id : b.worker_id))),
    );
    const bookingIds = bookingRows.map((b) => b.id);

    const [
      { data: jobs },
      { data: counterparts },
      { data: payments },
      { data: reviews },
      { data: walletCredits },
      { data: cancellationRequests, error: cancellationRequestError },
    ] =
      await Promise.all([
        jobIds.length > 0
          ? admin.from('jobs').select('id, title, category, location, urgency, description').in('id', jobIds)
          : Promise.resolve({ data: [] }),
        counterpartIds.length > 0
          ? admin.from('profiles').select('id, full_name, avatar_url').in('id', counterpartIds)
          : Promise.resolve({ data: [] }),
        bookingIds.length > 0
          ? admin
              .from('payments')
              .select('id, booking_id, amount, currency, display_amount_ngn, status, notes, created_at')
              .in('booking_id', bookingIds)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] }),
        bookingIds.length > 0
          ? admin.from('reviews').select('id, booking_id, rating, comment, created_at').in('booking_id', bookingIds)
          : Promise.resolve({ data: [] }),
        role === 'worker' && bookingIds.length > 0
          ? admin
              .from('worker_wallet_transactions')
              .select('booking_id, amount')
              .eq('worker_id', userId)
              .eq('transaction_type', 'credit')
              .eq('status', 'completed')
              .in('booking_id', bookingIds)
          : Promise.resolve({ data: [] }),
        bookingIds.length > 0
          ? admin
              .from('booking_cancellation_requests')
              .select('id, booking_id, requested_by, reason, status, review_note, created_at')
              .in('booking_id', bookingIds)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (cancellationRequestError) {
      res.status(500).json({ error: cancellationRequestError.message });
      return;
    }

    const jobMap = new Map((jobs || []).map((j) => [j.id, j]));
    const counterpartMap = new Map((counterparts || []).map((p) => [p.id, p]));
    const cancellationRequestMap = new Map();
    for (const request of cancellationRequests || []) {
      if (!cancellationRequestMap.has(request.booking_id)) {
        cancellationRequestMap.set(request.booking_id, request);
      }
    }

    // NEVER return phone_number or email here! Contact details only come from /api/bookings/:id/contact
    const enriched = bookingRows.map((b) => {
      const cpId = role === 'worker' ? b.customer_id : b.worker_id;
      const cp = counterpartMap.get(cpId);
      const latestPayment = (payments || []).find((p) => p.booking_id === b.id) || null;
      const review = (reviews || []).find((r) => r.booking_id === b.id) || null;
      const walletCredit = (walletCredits || []).find((transaction) => transaction.booking_id === b.id);
      return {
        ...b,
        job: jobMap.get(b.job_id) || null,
        counterpart: {
          id: cpId,
          full_name: cp?.full_name || (role === 'worker' ? 'Customer' : 'FixIt Professional'),
          avatar_url: cp?.avatar_url || '',
        },
        latest_payment: latestPayment,
        cancellation_request: cancellationRequestMap.get(b.id) || null,
        review,
        wallet_credit: walletCredit?.amount || 0,
      };
    });

    res.json({ bookings: enriched });
  });

  app.get('/api/bookings/:id/contact', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;
    const bookingId = req.params.id;

    const { data: booking, error } = await admin
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();

    if (error || !booking) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }

    const isCustomer = booking.customer_id === userId;
    const isWorker = booking.worker_id === userId;

    if (!isCustomer && !isWorker) {
      res.status(403).json({ error: 'Forbidden: you are not a participant in this booking.' });
      return;
    }

    const eligibleStatuses = ['confirmed', 'in_progress', 'completed'];
    if (booking.payment_status !== 'paid' || !eligibleStatuses.includes(booking.booking_status)) {
      res.status(403).json({
        error: isCustomer
          ? "Complete your booking deposit to unlock this worker's contact information."
          : 'Customer contact details will become available after the booking is confirmed.',
        locked: true,
      });
      return;
    }

    const targetUserId = isCustomer ? booking.worker_id : booking.customer_id;
    const { data: targetProfile } = await admin
      .from('profiles')
      .select('id, full_name, phone_number, city, address')
      .eq('id', targetUserId)
      .maybeSingle();

    res.json({
      locked: false,
      role: isCustomer ? 'worker' : 'customer',
      contact: {
        full_name: targetProfile?.full_name || 'FixIt User',
        phone_number: targetProfile?.phone_number || 'Phone number not provided yet',
        city: targetProfile?.city || 'Benin City',
        address: targetProfile?.address || 'Address not provided yet',
      },
    });
  });

  app.post(
    '/api/bookings/:id/balance/in-person-confirmation',
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      const admin = req.supabaseAdmin!;
      const actorId = req.authUser!.id;
      const { data: booking, error } = await admin.rpc('confirm_in_person_balance_payment', {
        p_booking_id: req.params.id,
        p_actor_id: actorId,
      });
      const updatedBooking = Array.isArray(booking) ? booking[0] : booking;

      if (error || !updatedBooking) {
        res.status(400).json({
          error: error?.message || 'Unable to confirm in-person balance payment.',
        });
        return;
      }

      const recipientId =
        actorId === updatedBooking.customer_id
          ? updatedBooking.worker_id
          : updatedBooking.customer_id;
      await admin.from('notifications').insert({
        user_id: recipientId,
        title:
          updatedBooking.balance_payment_status === 'paid'
            ? 'In-person balance confirmed'
            : 'In-person payment confirmation needed',
        message:
          updatedBooking.balance_payment_status === 'paid'
            ? 'Both participants confirmed the remaining in-person balance was paid.'
            : 'The other participant reported the remaining balance as paid in person. Please confirm or contact them.',
        type: 'balance_payment_confirmation',
        link: actorId === updatedBooking.customer_id ? '/worker/bookings' : '/customer/bookings',
      });

      res.json({ booking: updatedBooking });
    },
  );

  app.patch('/api/bookings/:id/status', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      status: z.enum(['in_progress', 'completed', 'cancelled']),
      cancellationReason: z.string().trim().max(1000).optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid booking status.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;
    const bookingId = req.params.id;

    const { data: booking } = await admin
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }

    const isCustomer = booking.customer_id === userId;
    const isWorker = booking.worker_id === userId;
    if (!isCustomer && !isWorker) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const nextStatus = parsed.data.status;

    if (nextStatus === 'cancelled') {
      if (booking.booking_status === 'in_progress' && parsed.data.cancellationReason.length < 10) {
        res.status(400).json({ error: 'Please explain why you are requesting cancellation (at least 10 characters).' });
        return;
      }

      const { data: cancellation, error: cancellationError } = await admin.rpc(
        'begin_booking_cancellation',
        {
          p_booking_id: bookingId,
          p_actor_id: userId,
          p_reason: parsed.data.cancellationReason,
        },
      );
      if (cancellationError) {
        res.status(500).json({ error: cancellationError.message });
        return;
      }

      if (cancellation?.result === 'not_found') {
        res.status(404).json({ error: 'Booking not found.' });
        return;
      }
      if (cancellation?.result === 'forbidden') {
        res.status(403).json({ error: 'Only booking participants can request cancellation.' });
        return;
      }
      if (cancellation?.result === 'not_cancellable') {
        res.status(409).json({ error: 'Completed or cancelled bookings cannot be cancelled.' });
        return;
      }
      if (cancellation?.result === 'pending_review') {
        const recipientId = isCustomer ? booking.worker_id : booking.customer_id;
        const { error: notificationError } = await admin.from('notifications').insert({
          user_id: recipientId,
          title: 'Booking cancellation needs review',
          message: 'A participant requested cancellation. The booking remains active and no refund has been issued yet.',
          type: 'booking_cancellation_review',
          link: isCustomer ? '/worker/bookings' : '/customer/bookings',
        });
        if (notificationError) {
          console.error('[FixIt] Could not notify booking participant about cancellation review:', notificationError);
        }

        res.status(202).json({
          cancellationRequest: {
            id: cancellation.request_id,
            status: 'pending_review',
          },
        });
        return;
      }
      if (cancellation?.result !== 'processing' || typeof cancellation.request_id !== 'string') {
        res.status(409).json({ error: 'A cancellation request is already being processed.' });
        return;
      }

      let refundStarted = false;
      let depositRefunded = false;
      let balanceRefunded = false;
      try {
        const { data: paymentRows, error: paymentReadError } = await admin
          .from('payments')
          .select('id, payment_type, status, stripe_session_id, stripe_payment_intent_id, stripe_refund_id')
          .eq('booking_id', bookingId)
          .in('status', ['pending', 'succeeded', 'refunded']);
        if (paymentReadError) throw paymentReadError;

        const stripePayments = paymentRows || [];
        for (const payment of stripePayments) {
          if (payment.status === 'refunded') {
            if (payment.payment_type === 'deposit') depositRefunded = true;
            if (payment.payment_type === 'balance') balanceRefunded = true;
            continue;
          }

          let paymentIntentId = payment.stripe_payment_intent_id;
          if (payment.status === 'pending' && payment.stripe_session_id) {
            const stripe = getStripeClient();
            if (!stripe) throw new Error('STRIPE_NOT_CONFIGURED');

            const session = await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
            if (session.status === 'open') {
              await stripe.checkout.sessions.expire(session.id);
              const { error: expireUpdateError } = await admin
                .from('payments')
                .update({ status: 'expired' })
                .eq('id', payment.id);
              if (expireUpdateError) throw expireUpdateError;
              continue;
            }

            if (session.payment_status !== 'paid') {
              const { error: expireUpdateError } = await admin
                .from('payments')
                .update({ status: 'expired' })
                .eq('id', payment.id);
              if (expireUpdateError) throw expireUpdateError;
              continue;
            }

            paymentIntentId =
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : session.payment_intent?.id || null;
          }

          if (payment.status === 'succeeded' && !paymentIntentId) {
            throw new Error('A successful Stripe payment is missing its payment intent; contact FixIt support.');
          }
          if (!paymentIntentId) continue;

          const refund = await refundPaymentIntent(paymentIntentId, `fixit-cancel-${payment.id}`);
          if (refund.status === 'failed') {
            throw new Error(`Stripe could not refund payment ${payment.id}. Contact FixIt support.`);
          }
          refundStarted = true;

          const { error: refundUpdateError } = await admin
            .from('payments')
            .update({
              status: 'refunded',
              stripe_payment_intent_id: paymentIntentId,
              stripe_refund_id: refund.id,
            })
            .eq('id', payment.id);
          if (refundUpdateError) throw refundUpdateError;

          if (payment.payment_type === 'deposit') depositRefunded = true;
          if (payment.payment_type === 'balance') balanceRefunded = true;
        }

        if (booking.payment_status === 'paid' && !depositRefunded) {
          throw new Error('The paid deposit could not be matched to a refundable Stripe payment. Contact FixIt support.');
        }

        const { data: finished, error: finishError } = await admin.rpc(
          'finish_booking_cancellation',
          {
            p_request_id: cancellation.request_id,
            p_succeeded: true,
            p_deposit_refunded: depositRefunded,
            p_balance_refunded: balanceRefunded,
            p_review_note: refundStarted
              ? 'Stripe refund issued before work started.'
              : 'Booking cancelled before work started; no successful Stripe payment needed a refund.',
          },
        );
        if (finishError) throw finishError;
        if (finished !== 'cancelled' && finished !== 'already_cancelled') {
          throw new Error('Unable to finalize booking cancellation.');
        }
      } catch (cancellationErr) {
        const message =
          cancellationErr instanceof Error
            ? cancellationErr.message
            : 'Unable to cancel booking.';
        if (!refundStarted) {
          const { error: rollbackError } = await admin.rpc('finish_booking_cancellation', {
            p_request_id: cancellation.request_id,
            p_succeeded: false,
            p_deposit_refunded: false,
            p_balance_refunded: false,
            p_review_note: message,
          });
          if (rollbackError) {
            console.error('[FixIt] Could not restore booking after cancellation failure:', rollbackError);
          }
        }
        res.status(502).json({ error: message });
        return;
      }

      const { error: cancelNotificationError } = await admin.from('notifications').insert({
        user_id: isCustomer ? booking.worker_id : booking.customer_id,
        title: 'Booking cancelled',
        message:
          depositRefunded || balanceRefunded
            ? 'The booking was cancelled. Stripe refunds for successful payments have been initiated.'
            : 'The booking was cancelled before work started.',
        type: 'booking_cancelled',
        link: isCustomer ? '/worker/bookings' : '/customer/bookings',
      });
      if (cancelNotificationError) {
        console.error('[FixIt] Could not notify booking participant about cancellation:', cancelNotificationError);
      }

      res.json({
        booking: { ...booking, booking_status: 'cancelled' },
        refundInitiated: depositRefunded || balanceRefunded,
      });
      return;
    }

    if (booking.booking_status === 'cancellation_pending') {
      res.status(409).json({ error: 'This booking is being cancelled and cannot be changed.' });
      return;
    }

    if ((nextStatus === 'in_progress' || nextStatus === 'completed') && booking.payment_status !== 'paid') {
      res.status(400).json({ error: 'Booking deposit must be paid before advancing job progress.' });
      return;
    }

    if (nextStatus === 'in_progress' && booking.booking_status !== 'confirmed') {
      res.status(409).json({ error: 'Only confirmed bookings can be started.' });
      return;
    }

    if (nextStatus === 'completed' && !isCustomer) {
      res.status(403).json({ error: 'Only the customer can confirm final job completion.' });
      return;
    }
    let updated = booking;
    let walletCredit = 0;
    if (nextStatus === 'completed') {
      const { data: completion, error } = await admin.rpc(
        'complete_booking_and_credit_wallet',
        {
          p_booking_id: bookingId,
          p_customer_id: userId,
        },
      );
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }

      const result = Array.isArray(completion) ? completion[0] : completion;
      walletCredit = Number(result?.credited_amount || 0);
      const { data: completedBooking, error: bookingReadError } = await admin
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();
      if (bookingReadError) {
        res.status(500).json({ error: bookingReadError.message });
        return;
      }
      updated = completedBooking;
    } else {
      const { data: changedBooking, error } = await admin
        .from('bookings')
        .update({ booking_status: nextStatus })
        .eq('id', bookingId)
        .eq('booking_status', 'confirmed')
        .select('*')
        .maybeSingle();

      if (error) {
        if (error.message.includes('cancellation request is waiting for manual review')) {
          res.status(409).json({ error: 'A cancellation request is waiting for manual review.' });
          return;
        }
        res.status(500).json({ error: error.message });
        return;
      }
      if (!changedBooking) {
        res.status(409).json({ error: 'This booking changed before the status update could be applied.' });
        return;
      }
      updated = changedBooking;

      if (nextStatus === 'in_progress') {
        await admin
          .from('jobs')
          .update({ status: nextStatus })
          .eq('id', booking.job_id);
      }
    }

    const { data: jobRow } = await admin
      .from('jobs')
      .select('title')
      .eq('id', booking.job_id)
      .maybeSingle();

    const targetNotifyId = isCustomer ? booking.worker_id : booking.customer_id;
    const targetLink = isCustomer ? '/worker/bookings' : '/customer/bookings';

    await admin.from('notifications').insert({
      user_id: targetNotifyId,
      title: `Booking ${nextStatus.replace('_', ' ')}`,
      message:
        nextStatus === 'completed'
          ? walletCredit > 0
            ? `Booking for "${jobRow?.title || 'your job'}" is complete. ${formatNaira(walletCredit)} has been added to the worker's FixIt wallet.`
            : `Booking for "${jobRow?.title || 'your job'}" is complete. Eligible wallet funds will be added after the remaining balance is confirmed paid.`
          : `Booking for "${jobRow?.title || 'your job'}" is now marked as ${nextStatus.replace('_', ' ')}.`,
      type: 'booking_status_changed',
      link: targetLink,
    });

    res.json({ booking: updated, walletCredit });
  });

  // ============================================================================
  // STRIPE CHECKOUT & STATUS ENDPOINTS
  // ============================================================================
  app.post('/api/payments/create-checkout-session', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({ bookingId: z.string().uuid() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid bookingId is required.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const user = req.authUser!;

    const { data: booking } = await admin
      .from('bookings')
      .select('*')
      .eq('id', parsed.data.bookingId)
      .maybeSingle();

    if (!booking) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }
    if (booking.customer_id !== user.id) {
      res.status(403).json({ error: 'Only the booking customer can pay the deposit.' });
      return;
    }
    if (booking.booking_status === 'cancelled' || booking.booking_status === 'cancellation_pending') {
      res.status(409).json({ error: 'This booking is being cancelled and cannot accept a deposit payment.' });
      return;
    }
    if (booking.payment_status === 'paid') {
      res.status(400).json({ error: 'Deposit has already been paid for this booking.' });
      return;
    }

    const { count: pendingPaymentCount, error: pendingPaymentError } = await admin
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', booking.id)
      .eq('payment_type', 'deposit')
      .eq('status', 'pending');
    if (pendingPaymentError) {
      res.status(500).json({ error: pendingPaymentError.message });
      return;
    }
    if ((pendingPaymentCount || 0) > 0) {
      res.status(409).json({
        error: 'A deposit checkout is already in progress. Complete it or wait for it to expire before retrying.',
      });
      return;
    }

    const { data: job } = await admin
      .from('jobs')
      .select('title')
      .eq('id', booking.job_id)
      .maybeSingle();

    try {
      const result = await createDepositCheckoutSession({
        booking,
        jobTitle: job?.title || 'Service Booking',
        customerEmail: user.email || '',
        supabaseAdmin: admin,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to start Stripe Checkout';
      if (msg === 'STRIPE_NOT_CONFIGURED') {
        res.status(503).json({
          error: 'Stripe is not configured on the server. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.',
          code: 'STRIPE_NOT_CONFIGURED',
        });
        return;
      }
      res.status(500).json({ error: msg });
    }
  });

  app.post(
    '/api/payments/create-balance-checkout-session',
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      const schema = z.object({ bookingId: z.string().uuid() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid bookingId is required.' });
        return;
      }

      const admin = req.supabaseAdmin!;
      const user = req.authUser!;
      const { data: booking } = await admin
        .from('bookings')
        .select('*')
        .eq('id', parsed.data.bookingId)
        .maybeSingle();

      if (!booking) {
        res.status(404).json({ error: 'Booking not found.' });
        return;
      }
      if (booking.customer_id !== user.id) {
        res.status(403).json({ error: 'Only the booking customer can pay the remaining balance.' });
        return;
      }

      const { data: paymentReservation, error: reservationError } = await admin.rpc(
        'begin_online_balance_payment',
        {
          p_booking_id: booking.id,
          p_customer_id: user.id,
        },
      );
      if (reservationError) {
        res.status(400).json({ error: reservationError.message });
        return;
      }
      const reservedBooking = Array.isArray(paymentReservation)
        ? paymentReservation[0]
        : paymentReservation;

      const { data: job } = await admin
        .from('jobs')
        .select('title')
        .eq('id', booking.job_id)
        .maybeSingle();

      try {
        const result = await createBalanceCheckoutSession({
          booking: reservedBooking || booking,
          jobTitle: job?.title || 'Service Booking',
          customerEmail: user.email || '',
          supabaseAdmin: admin,
        });
        res.json(result);
      } catch (err: unknown) {
        await admin
          .from('bookings')
          .update({ balance_payment_status: 'failed' })
          .eq('id', booking.id)
          .eq('balance_payment_status', 'pending');
        const message = err instanceof Error ? err.message : 'Unable to start balance payment.';
        if (message === 'STRIPE_NOT_CONFIGURED') {
          res.status(503).json({
            error: 'Stripe is not configured on the server. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.',
            code: 'STRIPE_NOT_CONFIGURED',
          });
          return;
        }
        res.status(500).json({ error: message });
      }
    },
  );

  app.post('/api/bookings/:id/payout', requireAuth, async (req: AuthenticatedRequest, res) => {
    res.status(410).json({ error: 'Per-booking payouts are no longer available. Withdraw from your FixIt wallet.' });
  });

  app.get('/api/payments/booking-status', requireAuth, async (req: AuthenticatedRequest, res) => {
    const bookingId = typeof req.query.bookingId === 'string' ? req.query.bookingId : '';
    if (!bookingId) {
      res.status(400).json({ error: 'bookingId is required.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;

    const { data: booking } = await admin
      .from('bookings')
      .select('id, job_id, customer_id, worker_id, agreed_price, deposit_amount, currency, payment_status, balance_payment_status, balance_payment_method, booking_status')
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }
    if (booking.customer_id !== userId && booking.worker_id !== userId) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const { data: payments } = await admin
      .from('payments')
      .select('id, stripe_session_id, stripe_payment_intent_id, amount, currency, display_amount_ngn, status, payment_type, notes, created_at')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false })
      .limit(3);

    res.json({ booking, payments: payments || [] });
  });

  // ============================================================================
  // NOTIFICATIONS ENDPOINTS
  // ============================================================================
  app.get('/api/notifications', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;

    const { data, error } = await admin
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const notifications = data || [];
    const unreadCount = notifications.filter((n) => !n.read_at).length;

    res.json({ notifications, unreadCount });
  });

  app.patch('/api/notifications/:id/read', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;

    const { data, error } = await admin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ notification: data });
  });

  app.post('/api/notifications/read-all', requireAuth, async (req: AuthenticatedRequest, res) => {
    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;

    const { error } = await admin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ ok: true });
  });

  // ============================================================================
  // REVIEWS & STORAGE UPLOAD ENDPOINTS
  // ============================================================================
  app.post('/api/reviews', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      bookingId: z.string().uuid(),
      rating: z.number().int().min(1).max(5),
      comment: z.string().trim().min(3).max(1000),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid review.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const customerId = req.authUser!.id;

    const { data: booking } = await admin
      .from('bookings')
      .select('*')
      .eq('id', parsed.data.bookingId)
      .maybeSingle();

    if (!booking) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }
    if (booking.customer_id !== customerId) {
      res.status(403).json({ error: 'Only the customer can review this booking.' });
      return;
    }
    if (booking.booking_status !== 'completed') {
      res.status(400).json({ error: 'You can review a worker only after the booking is marked completed.' });
      return;
    }

    const { data: existingReview } = await admin
      .from('reviews')
      .select('id')
      .eq('booking_id', booking.id)
      .maybeSingle();

    if (existingReview) {
      res.status(409).json({ error: 'You have already reviewed this booking.' });
      return;
    }

    const { data: review, error } = await admin
      .from('reviews')
      .insert({
        booking_id: booking.id,
        customer_id: customerId,
        worker_id: booking.worker_id,
        rating: parsed.data.rating,
        comment: parsed.data.comment,
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await admin.from('notifications').insert({
      user_id: booking.worker_id,
      title: 'New customer review',
      message: `You received a ${parsed.data.rating}-star review from a completed booking.`,
      type: 'review_received',
      link: '/worker/profile',
    });

    res.status(201).json({ review });
  });

  app.post('/api/uploads', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      dataUrl: z.string().min(20),
      folder: z.enum(['jobs', 'avatars']).default('jobs'),
      fileName: z.string().max(120).optional().default('upload.jpg'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid upload payload.' });
      return;
    }

    const match = parsed.data.dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
    if (!match) {
      res.status(400).json({ error: 'Only PNG, JPEG, or WebP images are allowed.' });
      return;
    }

    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength > 3 * 1024 * 1024) {
      res.status(400).json({ error: 'Image size must be 3MB or smaller.' });
      return;
    }

    const admin = req.supabaseAdmin!;
    const userId = req.authUser!.id;
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const path = `${userId}/${parsed.data.folder}/${Date.now()}.${ext}`;

    const { error: uploadErr } = await admin.storage
      .from('FixIt-uploads')
      .upload(path, buffer, { contentType: mimeType, upsert: false });

    if (uploadErr) {
      res.status(500).json({ error: uploadErr.message });
      return;
    }

    const { data: publicUrlData } = admin.storage.from('FixIt-uploads').getPublicUrl(path);
    res.status(201).json({ url: publicUrlData.publicUrl });
  });
}
