export interface MarketplaceCity {
  name: string;
  state: string;
  areas: string[];
}

export interface ServiceCategoryMeta {
  id: string;
  name: string;
  shortDescription: string;
  typicalWork: string[];
  imageUrl: string;
}

export interface LocalPricingBaseline {
  city: string;
  category: string;
  serviceType: string;
  minPrice: number;
  maxPrice: number;
  suggestedDeposit: number;
  currency: string;
  isProvisional: boolean;
  notes: string;
}

export const SUPPORTED_CITIES: MarketplaceCity[] = [
  {
    name: 'Benin City',
    state: 'Edo State',
    areas: [
      'Ugbowo',
      'GRA',
      'Ring Road',
      'Sapele Road',
      'Uselu',
      'Adesuwa',
      'Siluko',
      'Ekosodin',
      'Upper Sakponba',
      'Ikpoba Hill',
      'Ugbor',
      'Aduwawa',
    ],
  },
];

export const SERVICE_CATEGORIES: ServiceCategoryMeta[] = [
  {
    id: 'plumbing',
    name: 'Plumbing',
    shortDescription: 'Pipe leaks, blocked drains, sink installations, pumping machines, and bathroom fittings.',
    typicalWork: ['Leaking kitchen or bathroom pipes', 'WC and sink installation', 'Borehole and overhead tank lines', 'Blocked drain clearing'],
    imageUrl: '/src/assets/images/service_plumbing_1795040955570.jpg',
  },
  {
    id: 'electrical',
    name: 'Electrical repairs',
    shortDescription: 'Faulty sockets, changeover switches, breaker panels, inverter wiring, and lighting repairs.',
    typicalWork: ['Distribution board and breaker faults', 'Socket and switch replacements', 'Inverter and solar changeovers', 'Ceiling fan and light fitting'],
    imageUrl: '/src/assets/images/service_electrical_1795040957771.jpg',
  },
  {
    id: 'painting',
    name: 'Painting',
    shortDescription: 'Interior and exterior wall painting, POP touch-ups, damp proofing, and colour refreshes.',
    typicalWork: ['Full room repainting', 'Wall screeding and primer prep', 'Exterior facade weather coating', 'POP ceiling touch-ups'],
    imageUrl: '/src/assets/images/hero_benin_artisan_1795040955113.jpg',
  },
  {
    id: 'ac-repairs',
    name: 'AC repairs and maintenance',
    shortDescription: 'Split and standing AC servicing, filter flushing, drainage unblocking, and cooling diagnostics.',
    typicalWork: ['Split-unit preventive servicing', 'Indoor unit water leak clearing', 'Cooling performance inspection', 'Compressor and capacitor checks'],
    imageUrl: '/src/assets/images/service_ac_cleaning_1795040955551.jpg',
  },
  {
    id: 'cleaning',
    name: 'Cleaning',
    shortDescription: 'Residential deep cleaning, move-in/move-out apartment sanitization, and post-renovation cleanup.',
    typicalWork: ['Apartment deep cleaning', 'Post-renovation dust removal', 'Kitchen and bathroom degreasing', 'Office and shop cleaning'],
    imageUrl: '/src/assets/images/worker_team_portrait_1795040956540.jpg',
  },
];

export const CATEGORY_NAMES = SERVICE_CATEGORIES.map((c) => c.name);

export const DEFAULT_LOCAL_PRICING: LocalPricingBaseline[] = [
  {
    city: 'Benin City',
    category: 'Plumbing',
    serviceType: 'Repair',
    minPrice: 7000,
    maxPrice: 15000,
    suggestedDeposit: 2000,
    currency: 'ngn',
    isProvisional: true,
    notes: 'Provisional labor baseline for routine leak or fitting repairs; replacement pipes, valves, or adhesives are extra.',
  },
  {
    city: 'Benin City',
    category: 'Electrical repairs',
    serviceType: 'Repair',
    minPrice: 6000,
    maxPrice: 14000,
    suggestedDeposit: 2000,
    currency: 'ngn',
    isProvisional: true,
    notes: 'Provisional labor baseline for troubleshooting sockets, breakers, or lighting points; new components billed separately.',
  },
  {
    city: 'Benin City',
    category: 'Painting',
    serviceType: 'Interior',
    minPrice: 18000,
    maxPrice: 45000,
    suggestedDeposit: 3500,
    currency: 'ngn',
    isProvisional: true,
    notes: 'Provisional labor baseline depending on room count, wall condition, and screeding requirements; paint buckets excluded.',
  },
  {
    city: 'Benin City',
    category: 'AC repairs and maintenance',
    serviceType: 'Servicing',
    minPrice: 8000,
    maxPrice: 22000,
    suggestedDeposit: 2500,
    currency: 'ngn',
    isProvisional: true,
    notes: 'Provisional baseline for cleaning and diagnostic inspection; refrigerant recharge or spare parts add to cost.',
  },
  {
    city: 'Benin City',
    category: 'Cleaning',
    serviceType: 'Deep Clean',
    minPrice: 10000,
    maxPrice: 25000,
    suggestedDeposit: 2000,
    currency: 'ngn',
    isProvisional: true,
    notes: 'Provisional baseline for standard residential cleaning; scales with apartment bedrooms and heavy post-work buildup.',
  },
];

export const URGENCY_LEVELS = ['Low', 'Medium', 'High', 'Emergency'] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export function formatNaira(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  return `₦${Math.round(amount).toLocaleString('en-NG')}`;
}
