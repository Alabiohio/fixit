import { Link } from 'react-router-dom';
import { Logo } from './Logo';
import { SERVICE_CATEGORIES, SUPPORTED_CITIES } from '../../shared/constants';

export function PublicFooter() {
  const beninAreas = SUPPORTED_CITIES[0].areas.slice(0, 6);

  return (
    <footer className="bg-[#1A1B25] text-white/80 border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="space-y-3">
            <Logo size="lg" />
            <p className="text-sm text-white/70 leading-relaxed">
              Find help. Compare offers. Book with confidence.
            </p>
            <p className="text-xs text-white/50">
              Built for Benin City, Edo State, Nigeria — structured to expand across Nigerian cities.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Platform</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/how-it-works" className="hover:text-white transition-colors">
                  How It Works
                </Link>
              </li>
              <li>
                <Link to="/services" className="hover:text-white transition-colors">
                  Services
                </Link>
              </li>
              <li>
                <Link to="/signup" className="hover:text-white transition-colors">
                  Find a Professional
                </Link>
              </li>
              <li>
                <Link to="/signup?role=worker" className="hover:text-white transition-colors">
                  Become a Worker
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Categories</h3>
            <ul className="space-y-2 text-sm text-white/70">
              {SERVICE_CATEGORIES.map((cat) => (
                <li key={cat.id}>
                  <Link to={`/services#${cat.id}`} className="hover:text-white transition-colors">
                    {cat.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Benin City Coverage</h3>
            <p className="text-sm text-white/70 leading-relaxed">
              {beninAreas.join(' · ')} and surrounding neighborhoods.
            </p>
            <div className="mt-4 pt-4 border-t border-white/10 text-xs text-white/50">
              Contact numbers stay protected until deposit payment is verified via Stripe.
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-white/50">
          <span>© {new Date().getFullYear()} BookAm Marketplace. All rights reserved.</span>
          <span>Benin City, Edo State, Nigeria</span>
        </div>
      </div>
    </footer>
  );
}
