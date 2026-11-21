import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PublicNavbar } from '../../components/PublicNavbar';
import { PublicFooter } from '../../components/PublicFooter';
import { DEFAULT_LOCAL_PRICING, SERVICE_CATEGORIES, SUPPORTED_CITIES, formatNaira } from '../../../shared/constants';

export function ServicesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F6F7FB]">
      <PublicNavbar />

      <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-10">
        <div className="space-y-3 max-w-2xl">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1A1B25]">
            Skilled home and commercial services
          </h1>
          <p className="text-base text-[#6B7280]">
            Initial launch categories in Benin City, with provisional indicative labor baselines shown for transparency.
          </p>
        </div>

        <div className="space-y-6">
          {SERVICE_CATEGORIES.map((cat) => {
            const baseline = DEFAULT_LOCAL_PRICING.find((p) => p.category === cat.name);
            return (
              <div
                key={cat.id}
                id={cat.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden grid grid-cols-1 md:grid-cols-12"
              >
                <div className="md:col-span-4 bg-slate-100 aspect-[4/3] md:aspect-auto">
                  <img
                    src={cat.imageUrl}
                    alt={cat.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="md:col-span-8 p-6 sm:p-8 flex flex-col justify-between gap-6">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-xl font-bold text-[#1A1B25]">{cat.name}</h2>
                      {baseline && (
                        <span className="text-xs font-medium text-[#FF6B35] font-mono-nums">
                          Provisional guide: {formatNaira(baseline.minPrice)} – {formatNaira(baseline.maxPrice)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[#6B7280] mt-2 leading-relaxed">
                      {cat.shortDescription}
                    </p>
                    <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#1A1B25]">
                      {cat.typicalWork.map((work) => (
                        <li key={work} className="bg-[#F6F7FB] rounded-lg px-3 py-2">
                          {work}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-100">
                    <span className="text-xs text-[#6B7280]">
                      Covering {SUPPORTED_CITIES[0].areas.slice(0, 5).join(', ')} and nearby areas
                    </span>
                    <Link
                      to="/customer/jobs/new"
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#635BFF] hover:text-[#4A44C6]"
                    >
                      Post a {cat.name.toLowerCase()} job
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
