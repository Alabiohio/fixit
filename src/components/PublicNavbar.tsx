import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Logo } from './Logo';
import { useAuth } from '../context/AuthContext';

export function PublicNavbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();

  return (
    <header className="bg-[#1A1B25] text-white border-b border-white/10 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        <Logo size="md" />

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-white/85">
          <Link
            to="/how-it-works"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            How It Works
          </Link>
          <Link
            to="/services"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Services
          </Link>
          <Link
            to={user ? '/worker/dashboard' : '/signup?role=worker'}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Become a Worker
          </Link>
          <Link
            to={user ? '/customer/dashboard' : '/login'}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            {user ? 'Dashboard' : 'Sign In'}
          </Link>
        </nav>

        <div className="hidden md:flex items-center shrink-0">
          <Link
            to={user ? '/customer/jobs/new' : '/signup'}
            className="px-4 py-2 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            {user ? 'Post a Job' : 'Get Started'}
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="md:hidden p-2 rounded-lg text-white/85 hover:text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          aria-label="Toggle navigation menu"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-[#1A1B25] border-t border-white/10 px-4 py-4 space-y-3">
          <Link
            to="/how-it-works"
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-sm font-medium text-white/90 hover:text-white"
          >
            How It Works
          </Link>
          <Link
            to="/services"
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-sm font-medium text-white/90 hover:text-white"
          >
            Services
          </Link>
          <Link
            to={user ? '/worker/dashboard' : '/signup?role=worker'}
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-sm font-medium text-white/90 hover:text-white"
          >
            Become a Worker
          </Link>
          <Link
            to={user ? '/customer/dashboard' : '/login'}
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-sm font-medium text-white/90 hover:text-white"
          >
            {user ? 'Dashboard' : 'Sign In'}
          </Link>
          <Link
            to={user ? '/customer/jobs/new' : '/signup'}
            onClick={() => setMobileOpen(false)}
            className="block w-full text-center px-4 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold"
          >
            {user ? 'Post a Job' : 'Get Started'}
          </Link>
        </div>
      )}
    </header>
  );
}
