import Groq from 'groq-sdk';
import { z } from 'zod';
import {
  CATEGORY_NAMES,
  DEFAULT_LOCAL_PRICING,
  SUPPORTED_CITIES,
  URGENCY_LEVELS,
  type LocalPricingBaseline,
} from '../shared/constants.ts';
import { getDefaultCurrency, getDefaultDeposit, getGroqApiKey, getGroqModel } from './config.ts';

function getGroqClient(): Groq | null {
  const apiKey = getGroqApiKey();
  if (!apiKey) return null;
  return new Groq({ apiKey });
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI response did not contain a JSON object');
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

// ============================================================================
// D. AI Input Validation
// ============================================================================
export const ValidateJobResultSchema = z.object({
  valid: z.boolean(),
  status: z.enum(['valid', 'empty', 'gibberish', 'unsupported', 'ambiguous', 'ai_unavailable']),
  message: z.string(),
  suggestions: z.array(z.string()).default([]),
  allowManual: z.boolean().default(true),
});

export type ValidateJobResult = z.infer<typeof ValidateJobResultSchema>;

function isLikelyGibberish(text: string): boolean {
  const cleaned = text.trim();
  if (cleaned.length < 8) return true;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    // Single token under 15 chars like "asdgfh" or keyboard mash
    if (cleaned.length < 18) return true;
  }
  // Check ratio of vowels in alphabetic characters
  const letters = cleaned.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 6) return true;
  const vowels = letters.replace(/[^aeiouAEIOU]/g, '').length;
  const vowelRatio = vowels / letters.length;
  if (vowelRatio < 0.14 || vowelRatio > 0.85) return true;
  // Repeated characters like "aaaaaa"
  if (/(.)\1{4,}/i.test(cleaned)) return true;
  return false;
}

export async function validateJob(description: string): Promise<ValidateJobResult> {
  const trimmed = (description || '').trim();

  if (!trimmed) {
    return {
      valid: false,
      status: 'empty',
      message: 'Please describe the service you need before continuing.',
      suggestions: [
        'Mention what is broken or what service you need (e.g., leaking pipe, AC servicing).',
        'Include your Benin City neighborhood (e.g., Ugbowo, GRA, Ring Road).',
      ],
      allowManual: true,
    };
  }

  if (isLikelyGibberish(trimmed)) {
    return {
      valid: false,
      status: 'gibberish',
      message:
        "We couldn't confidently understand this request. Please provide more details about the task and your neighborhood, or select a service category manually.",
      suggestions: [
        'Describe the problem clearly in a sentence or two.',
        'Example: "My kitchen pipe is leaking in Ugbowo and I need a plumber tomorrow."',
      ],
      allowManual: true,
    };
  }

  const groq = getGroqClient();
  if (!groq) {
    return {
      valid: false,
      status: 'ai_unavailable',
      message:
        "We couldn't run automated AI analysis right now because Groq AI is not configured. You can select a service category and publish your job manually.",
      suggestions: ['Select a service category and neighborhood manually below.'],
      allowManual: true,
    };
  }

  try {
    const completion = await groq.chat.completions.create({
      model: getGroqModel(),
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You validate customer service requests for BookAm, a local home-services marketplace in Benin City, Nigeria.
Supported categories: ${CATEGORY_NAMES.join(', ')}.
Return ONLY JSON matching:
{
  "valid": boolean,
  "status": "valid" | "gibberish" | "unsupported" | "ambiguous",
  "message": string,
  "suggestions": string[],
  "allowManual": true
}
Rules:
- Mark "gibberish" if the input is random characters, keyboard mash, or meaningless text.
- Mark "unsupported" if the request is clearly unrelated to home/local repair & maintenance services (e.g., flight booking, crypto trading, medical advice, essay writing).
- Mark "ambiguous" if it hints at help needed but lacks enough clarity to identify what work is required.
- Mark "valid" if it describes a real local service task in or adaptable to the supported categories.`,
        },
        {
          role: 'user',
          content: trimmed,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || '';
    const parsed = ValidateJobResultSchema.parse(extractJsonObject(raw));
    return { ...parsed, allowManual: true };
  } catch (err) {
    console.error('[BookAm AI] validateJob fallback triggered:', err);
    return {
      valid: false,
      status: 'ai_unavailable',
      message:
        "We couldn't confidently understand this request right now. Please provide more details or select a service category manually.",
      suggestions: ['Select your service category and neighborhood manually to continue.'],
      allowManual: true,
    };
  }
}

// ============================================================================
// A. Job Understanding
// ============================================================================
export const UnderstandJobSchema = z.object({
  category: z.string(),
  title: z.string().min(3),
  problem: z.string().min(3),
  serviceType: z.string().min(2),
  location: z.string(),
  urgency: z.enum(URGENCY_LEVELS),
  missingInfo: z.array(z.string()).default([]),
  additionalQuestions: z.array(z.string()).default([]),
  detectedBudget: z.number().int().positive().nullable().optional(),
  aiUsed: z.boolean().optional(),
});

export type UnderstandJobResult = z.infer<typeof UnderstandJobSchema>;

function normalizeCategory(rawCategory: string): string {
  const lower = rawCategory.trim().toLowerCase();
  const exact = CATEGORY_NAMES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  if (lower.includes('plumb') || lower.includes('pipe') || lower.includes('water')) return 'Plumbing';
  if (lower.includes('electr') || lower.includes('wire') || lower.includes('socket') || lower.includes('light')) {
    return 'Electrical repairs';
  }
  if (lower.includes('paint') || lower.includes('wall')) return 'Painting';
  if (lower.includes('ac') || lower.includes('air') || lower.includes('cool') || lower.includes('hvac')) {
    return 'AC repairs and maintenance';
  }
  if (lower.includes('clean') || lower.includes('wash') || lower.includes('tidy')) return 'Cleaning';
  return CATEGORY_NAMES[0];
}

export async function understandJob(description: string): Promise<UnderstandJobResult> {
  const trimmed = description.trim();
  const knownAreas = SUPPORTED_CITIES.flatMap((c) => c.areas);
  const groq = getGroqClient();

  if (!groq) {
    throw new Error('GROQ_NOT_CONFIGURED');
  }

  const completion = await groq.chat.completions.create({
    model: getGroqModel(),
    temperature: 0.15,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are BookAm Intelligence, an assistant for a local home-services marketplace in Benin City, Nigeria.
Available categories (pick the closest exact name): ${CATEGORY_NAMES.join(', ')}.
Known Benin City areas: ${knownAreas.join(', ')}.
Urgency options: ${URGENCY_LEVELS.join(', ')}.

Extract structured JSON from the customer's request:
{
  "category": string,
  "title": string (concise 3-6 word job title),
  "problem": string (clear 1-sentence summary of the issue),
  "serviceType": string (e.g., "Repair", "Installation", "Servicing", "Deep Clean", "Inspection"),
  "location": string (neighborhood in Benin City if mentioned, otherwise ""),
  "urgency": "Low" | "Medium" | "High" | "Emergency",
  "missingInfo": string[] (important missing facts like exact neighborhood or access details),
  "additionalQuestions": string[] (1-3 practical questions a technician would ask),
  "detectedBudget": number | null (numeric NGN amount if customer stated a budget, else null)
}
Return ONLY valid JSON.`,
      },
      {
        role: 'user',
        content: trimmed,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '';
  const parsed = UnderstandJobSchema.parse(extractJsonObject(raw));
  return {
    ...parsed,
    category: normalizeCategory(parsed.category),
    aiUsed: true,
  };
}

// ============================================================================
// B. AI Price Estimator
// ============================================================================
export const PriceEstimateSchema = z.object({
  estimatedMin: z.number().int().nonnegative(),
  estimatedMax: z.number().int().nonnegative(),
  suggestedDeposit: z.number().int().nonnegative(),
  currency: z.string().default('ngn'),
  explanation: z.string(),
  assumptions: z.array(z.string()).default([]),
  priceDrivers: z.array(z.string()).default([]),
  dataQuality: z.enum(['Provisional local baseline', 'Insufficient local data — indicative only']),
  isProvisional: z.boolean().default(true),
  disclaimer: z.string(),
});

export type PriceEstimateResult = z.infer<typeof PriceEstimateSchema>;

export async function estimatePrice(
  job: {
    category: string;
    title: string;
    description: string;
    serviceType?: string;
    location?: string;
    urgency?: string;
  },
  pricingConfigs: LocalPricingBaseline[] = DEFAULT_LOCAL_PRICING,
): Promise<PriceEstimateResult> {
  const defaultCurrency = getDefaultCurrency();
  const defaultDeposit = getDefaultDeposit();

  const matchingConfig =
    pricingConfigs.find((cfg) => cfg.category.toLowerCase() === job.category.toLowerCase()) ||
    DEFAULT_LOCAL_PRICING.find((cfg) => cfg.category.toLowerCase() === job.category.toLowerCase()) ||
    DEFAULT_LOCAL_PRICING[0];

  const groq = getGroqClient();

  if (!groq) {
    return {
      estimatedMin: matchingConfig.minPrice,
      estimatedMax: matchingConfig.maxPrice,
      suggestedDeposit: matchingConfig.suggestedDeposit || defaultDeposit,
      currency: defaultCurrency,
      explanation: `${matchingConfig.notes} These figures are provisional guide ranges derived from editable local baseline settings rather than verified Benin market quotes.`,
      assumptions: [
        'Standard residential access during daytime hours',
        'Routine labor only unless replacement parts are quoted separately by the worker',
      ],
      priceDrivers: [
        'Cost of spare parts or replacement fittings',
        'Accessibility of the fault and job duration',
        'Urgency or same-day callout timing',
      ],
      dataQuality: 'Provisional local baseline',
      isProvisional: true,
      disclaimer:
        'Indicative estimate only — not a guaranteed final quotation. Compare actual worker offers before booking.',
    };
  }

  try {
    const completion = await groq.chat.completions.create({
      model: getGroqModel(),
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are BookAm's provisional price guidance assistant for Benin City, Nigeria.
STRICT PRICING RULES:
- Do NOT invent or claim verified Benin City market pricing.
- Anchor your estimate strictly to the provided editable local pricing configuration.
- Clearly label the estimate as provisional.
- Never present the estimate as a guaranteed final quotation.
- Explain what could increase or decrease the final price.
- Suggested deposit should use the configured baseline deposit (${matchingConfig.suggestedDeposit || defaultDeposit} NGN) unless there is a clear reason within config bounds.

Editable Local Pricing Config for ${job.category}:
${JSON.stringify(matchingConfig)}

Return ONLY JSON matching:
{
  "estimatedMin": number (integer NGN),
  "estimatedMax": number (integer NGN >= estimatedMin),
  "suggestedDeposit": number (integer NGN),
  "currency": "${defaultCurrency}",
  "explanation": string,
  "assumptions": string[],
  "priceDrivers": string[],
  "dataQuality": "Provisional local baseline" | "Insufficient local data — indicative only",
  "isProvisional": true,
  "disclaimer": string
}`,
        },
        {
          role: 'user',
          content: JSON.stringify(job),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || '';
    const parsed = PriceEstimateSchema.parse(extractJsonObject(raw));
    return {
      ...parsed,
      estimatedMax: Math.max(parsed.estimatedMax, parsed.estimatedMin),
      isProvisional: true,
      currency: defaultCurrency,
    };
  } catch (err) {
    console.error('[BookAm AI] estimatePrice fallback triggered:', err);
    return {
      estimatedMin: matchingConfig.minPrice,
      estimatedMax: matchingConfig.maxPrice,
      suggestedDeposit: matchingConfig.suggestedDeposit || defaultDeposit,
      currency: defaultCurrency,
      explanation: `${matchingConfig.notes} Provisional guidance based on editable baseline configuration.`,
      assumptions: ['Standard residential fault inspection and labor'],
      priceDrivers: ['Replacement materials required', 'Severity and time required on site'],
      dataQuality: 'Provisional local baseline',
      isProvisional: true,
      disclaimer:
        'Indicative estimate only — not a guaranteed final quotation. Review worker offers carefully.',
    };
  }
}

// ============================================================================
// C. AI Offer Analysis
// ============================================================================
export const OfferAnalysisSchema = z.object({
  summary: z.string(),
  comparisons: z.array(
    z.object({
      offerId: z.string(),
      workerName: z.string(),
      assessment: z.string(),
      pricePosition: z.enum(['Within estimate', 'Below estimate', 'Above estimate', 'No estimate available']),
      consideration: z.string(),
    }),
  ),
  guidanceNote: z.string(),
});

export type OfferAnalysisResult = z.infer<typeof OfferAnalysisSchema>;

export interface OfferForAnalysis {
  id: string;
  workerName: string;
  proposedPrice: number;
  estimatedCompletion: string;
  availability: string;
  message: string;
  averageRating: number | null;
  completedJobs: number;
}

export async function analyzeOffers(
  job: {
    title: string;
    category: string;
    location: string;
    estimatedMin: number | null;
    estimatedMax: number | null;
    budget: number | null;
  },
  offers: OfferForAnalysis[],
): Promise<OfferAnalysisResult> {
  if (offers.length === 0) {
    return {
      summary: 'No worker offers have been submitted for this job yet.',
      comparisons: [],
      guidanceNote: 'Once workers submit offers, BookAm Intelligence can compare pricing, ratings, and availability.',
    };
  }

  const groq = getGroqClient();

  const buildDeterministicFallback = (): OfferAnalysisResult => {
    const comparisons = offers.map((o) => {
      let pricePosition: 'Within estimate' | 'Below estimate' | 'Above estimate' | 'No estimate available' =
        'No estimate available';
      let assessment = `${o.workerName} offered ₦${o.proposedPrice.toLocaleString('en-NG')}.`;
      let consideration = `Availability: ${o.availability}.`;

      if (job.estimatedMin !== null && job.estimatedMax !== null) {
        if (o.proposedPrice < job.estimatedMin) {
          pricePosition = 'Below estimate';
          assessment = `${o.workerName}'s ₦${o.proposedPrice.toLocaleString('en-NG')} offer is below the indicative estimate range.`;
          consideration = 'Confirm whether materials or replacement parts are included in this quote.';
        } else if (o.proposedPrice > job.estimatedMax) {
          pricePosition = 'Above estimate';
          assessment = `${o.workerName}'s ₦${o.proposedPrice.toLocaleString('en-NG')} offer is above the indicative estimate range.`;
          consideration = 'Check if the offer includes parts, extended labor, or urgent callout coverage.';
        } else {
          pricePosition = 'Within estimate';
          assessment = `${o.workerName}'s ₦${o.proposedPrice.toLocaleString('en-NG')} offer is within the indicative estimate range.`;
          consideration =
            o.averageRating !== null
              ? `Rated ${o.averageRating.toFixed(1)}/5 across ${o.completedJobs} completed jobs.`
              : `${o.completedJobs} completed jobs on BookAm.`;
        }
      }

      return {
        offerId: o.id,
        workerName: o.workerName,
        assessment,
        pricePosition,
        consideration,
      };
    });

    return {
      summary: comparisons.map((c) => c.assessment).join(' '),
      comparisons,
      guidanceNote: 'Compare price inclusions, worker experience, and schedule before choosing an offer.',
    };
  };

  if (!groq) {
    return buildDeterministicFallback();
  }

  try {
    const completion = await groq.chat.completions.create({
      model: getGroqModel(),
      temperature: 0.15,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are BookAm Intelligence comparing worker offers for a customer in Benin City, Nigeria.
RULES:
- Compare offers objectively using proposedPrice, the job's indicative estimate range (estimatedMin..estimatedMax), worker rating, completedJobs, and availability.
- Highlight if an offer is below estimate (advise asking what the price includes), within estimate, or above estimate.
- NEVER automatically select or command the customer to pick a specific worker. Present balanced trade-offs so the customer decides.

Return ONLY JSON matching:
{
  "summary": string (2-4 clear sentences comparing the offers side by side),
  "comparisons": [
    {
      "offerId": string,
      "workerName": string,
      "assessment": string,
      "pricePosition": "Within estimate" | "Below estimate" | "Above estimate" | "No estimate available",
      "consideration": string
    }
  ],
  "guidanceNote": string
}`,
        },
        {
          role: 'user',
          content: JSON.stringify({ job, offers }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || '';
    return OfferAnalysisSchema.parse(extractJsonObject(raw));
  } catch (err) {
    console.error('[BookAm AI] analyzeOffers fallback triggered:', err);
    return buildDeterministicFallback();
  }
}
