export interface AppConfig {
  appUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  stripePublishableKey: string;
  defaultCurrency: string;
  defaultDeposit: number;
  configuredServices: {
    supabase: boolean;
    groq: boolean;
    stripe: boolean;
    stripeWebhook: boolean;
  };
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone_number: string;
  address: string;
  avatar_url: string;
  city: string;
  created_at: string;
  updated_at: string;
}

export interface WorkerProfile {
  id: string;
  user_id: string;
  bio: string;
  service_categories: string[];
  service_locations: string[];
  availability: string;
  created_at: string;
  updated_at: string;
}

export interface WorkerStats {
  averageRating: number | null;
  reviewCount: number;
  completedJobs: number;
}

export interface ValidateJobResult {
  valid: boolean;
  status: 'valid' | 'empty' | 'gibberish' | 'unsupported' | 'ambiguous' | 'ai_unavailable';
  message: string;
  suggestions: string[];
  allowManual: boolean;
}

export interface UnderstandJobResult {
  category: string;
  title: string;
  problem: string;
  serviceType: string;
  location: string;
  urgency: 'Low' | 'Medium' | 'High' | 'Emergency';
  missingInfo: string[];
  additionalQuestions: string[];
  detectedBudget?: number | null;
  aiUsed?: boolean;
}

export interface PriceEstimateResult {
  estimatedMin: number;
  estimatedMax: number;
  suggestedDeposit: number;
  currency: string;
  explanation: string;
  assumptions: string[];
  priceDrivers: string[];
  dataQuality: 'Provisional local baseline' | 'Insufficient local data — indicative only';
  isProvisional: boolean;
  disclaimer: string;
}

export interface Job {
  id: string;
  customer_id?: string;
  customer_name?: string;
  title: string;
  description: string;
  category: string;
  city: string;
  location: string;
  budget: number | null;
  estimated_min: number | null;
  estimated_max: number | null;
  suggested_deposit: number | null;
  estimate_explanation?: string;
  estimate_assumptions?: string[];
  estimate_is_provisional?: boolean;
  urgency: 'Low' | 'Medium' | 'High' | 'Emergency';
  reference_image_url?: string;
  additional_questions?: string[];
  status: 'open' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  offer_count?: number;
  pending_offer_count?: number;
  has_my_offer?: boolean;
  my_offer_status?: string | null;
  created_at: string;
}

export interface OfferWorkerInfo {
  id: string;
  full_name: string;
  avatar_url: string;
  bio: string;
  service_categories: string[];
  service_locations: string[];
  availability: string;
  average_rating: number | null;
  review_count: number;
  completed_jobs: number;
}

export interface Offer {
  id: string;
  job_id: string;
  worker_id: string;
  proposed_price: number;
  estimated_completion: string;
  availability: string;
  message: string;
  negotiation_count: number;
  negotiation_by: string | null;
  negotiation_message: string;
  negotiation_pending: boolean;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';
  created_at: string;
  worker?: OfferWorkerInfo;
  job?: Partial<Job> | null;
}

export interface PaymentRecord {
  id: string;
  booking_id?: string;
  stripe_session_id?: string;
  stripe_payment_intent_id?: string | null;
  amount: number;
  currency: string;
  display_amount_ngn?: number | null;
  status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded';
  payment_type?: 'deposit' | 'balance';
  notes?: string;
  created_at: string;
}

export interface Review {
  id: string;
  booking_id: string;
  rating: number;
  comment: string;
  created_at: string;
}

export interface Booking {
  id: string;
  job_id: string;
  offer_id: string;
  customer_id: string;
  worker_id: string;
  agreed_price: number;
  deposit_amount: number;
  currency: string;
  payment_status: 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded';
  balance_payment_status:
    | 'unpaid'
    | 'pending'
    | 'reported'
    | 'paid'
    | 'failed'
    | 'refunded'
    | 'not_applicable';
  balance_payment_method: 'online' | 'in_person' | null;
  balance_customer_confirmed_at: string | null;
  balance_worker_confirmed_at: string | null;
  booking_status:
    | 'pending_payment'
    | 'confirmed'
    | 'in_progress'
    | 'cancellation_pending'
    | 'completed'
    | 'cancelled';
  created_at: string;
  job?: Partial<Job> | null;
  counterpart?: {
    id: string;
    full_name: string;
    avatar_url: string;
  };
  latest_payment?: PaymentRecord | null;
  cancellation_request?: {
    id: string;
    requested_by: string;
    reason: string;
    status: 'pending_review' | 'processing' | 'cancelled' | 'failed' | 'rejected';
    review_note: string;
    created_at: string;
  } | null;
  wallet_credit?: number;
  review?: Review | null;
}

export interface WalletTransaction {
  id: string;
  booking_id: string | null;
  transaction_type: 'credit' | 'withdrawal';
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  reference: string;
  description: string;
  transfer_code: string | null;
  failure_reason: string;
  created_at: string;
}

export interface OfferAnalysisResult {
  summary: string;
  comparisons: Array<{
    offerId: string;
    workerName: string;
    assessment: string;
    pricePosition: 'Within estimate' | 'Below estimate' | 'Above estimate' | 'No estimate available';
    consideration: string;
  }>;
  guidanceNote: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  link: string;
  read_at: string | null;
  created_at: string;
}
