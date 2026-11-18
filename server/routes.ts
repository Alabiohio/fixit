import express, { type Express } from 'express';
import { z } from 'zod';
import {
  CATEGORY_NAMES,
  DEFAULT_LOCAL_PRICING,
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
  getDefaultDeposit,
  getPublicAppConfig,
} from './config.ts';
import { createDepositCheckoutSession, handleStripeWebhookEvent } from './stripe.ts';
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
      fullName: p?.full_name || 'BookAm Professional',
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
        console.error('[BookAm Stripe Webhook Error]', message);
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
      console.error('[BookAm AI analyze-request fallback]', err);
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

    if (parsed.data.full_name || parsed.data.phone_number || parsed.data.avatar_url !== undefined) {
      const profileUpdate: Record<string, string> = {};
      if (parsed.data.full_name) profileUpdate.full_name = parsed.data.full_name;
      if (parsed.data.phone_number) profileUpdate.phone_number = parsed.data.phone_number;
      if (parsed.data.avatar_url !== undefined) profileUpdate.avatar_url = parsed.data.avatar_url;

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
            full_name: ws?.fullName || 'BookAm Professional',
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
      .select('id, job_id, offer_id, customer_id, worker_id, agreed_price, deposit_amount, currency, payment_status, booking_status, created_at')
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
      .select('id, customer_id, suggested_deposit')
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

    const depositAmount =
      job.suggested_deposit && job.suggested_deposit > 0
        ? job.suggested_deposit
        : getDefaultDeposit();
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

    const [{ data: jobs }, { data: counterparts }, { data: payments }, { data: reviews }] =
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
      ]);

    const jobMap = new Map((jobs || []).map((j) => [j.id, j]));
    const counterpartMap = new Map((counterparts || []).map((p) => [p.id, p]));

    // NEVER return phone_number or email here! Contact details only come from /api/bookings/:id/contact
    const enriched = bookingRows.map((b) => {
      const cpId = role === 'worker' ? b.customer_id : b.worker_id;
      const cp = counterpartMap.get(cpId);
      const latestPayment = (payments || []).find((p) => p.booking_id === b.id) || null;
      const review = (reviews || []).find((r) => r.booking_id === b.id) || null;
      return {
        ...b,
        job: jobMap.get(b.job_id) || null,
        counterpart: {
          id: cpId,
          full_name: cp?.full_name || (role === 'worker' ? 'Customer' : 'BookAm Professional'),
          avatar_url: cp?.avatar_url || '',
        },
        latest_payment: latestPayment,
        review,
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
      .select('id, full_name, phone_number, city')
      .eq('id', targetUserId)
      .maybeSingle();

    res.json({
      locked: false,
      role: isCustomer ? 'worker' : 'customer',
      contact: {
        full_name: targetProfile?.full_name || 'BookAm User',
        phone_number: targetProfile?.phone_number || 'Phone number not provided yet',
        city: targetProfile?.city || 'Benin City',
      },
    });
  });

  app.patch('/api/bookings/:id/status', requireAuth, async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      status: z.enum(['in_progress', 'completed', 'cancelled']),
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

    if ((nextStatus === 'in_progress' || nextStatus === 'completed') && booking.payment_status !== 'paid') {
      res.status(400).json({ error: 'Booking deposit must be paid before advancing job progress.' });
      return;
    }

    if (nextStatus === 'completed' && !isCustomer) {
      res.status(403).json({ error: 'Only the customer can confirm final job completion.' });
      return;
    }

    const { data: updated, error } = await admin
      .from('bookings')
      .update({ booking_status: nextStatus })
      .eq('id', bookingId)
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Sync job status
    if (nextStatus === 'in_progress' || nextStatus === 'completed' || nextStatus === 'cancelled') {
      await admin
        .from('jobs')
        .update({ status: nextStatus })
        .eq('id', booking.job_id);
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
      message: `Booking for "${jobRow?.title || 'your job'}" is now marked as ${nextStatus.replace('_', ' ')}.`,
      type: nextStatus === 'cancelled' ? 'booking_cancelled' : 'booking_status_changed',
      link: targetLink,
    });

    res.json({ booking: updated });
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
    if (booking.payment_status === 'paid') {
      res.status(400).json({ error: 'Deposit has already been paid for this booking.' });
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
      .select('id, job_id, customer_id, worker_id, deposit_amount, currency, payment_status, booking_status')
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
      .select('id, stripe_session_id, stripe_payment_intent_id, amount, currency, display_amount_ngn, status, notes, created_at')
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
      .from('bookam-uploads')
      .upload(path, buffer, { contentType: mimeType, upsert: false });

    if (uploadErr) {
      res.status(500).json({ error: uploadErr.message });
      return;
    }

    const { data: publicUrlData } = admin.storage.from('bookam-uploads').getPublicUrl(path);
    res.status(201).json({ url: publicUrlData.publicUrl });
  });
}
