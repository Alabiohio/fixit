import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Star, UserCheck } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { SetupNotice } from '../../components/SetupNotice';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../lib/api';
import { formatNaira } from '../../../shared/constants';
import type { Booking, Job, Offer } from '../../types/FixIt';

export function WorkerDashboardPage() {
  const { profile, workerProfile, workerStats } = useAuth();
  const [boardJobs, setBoardJobs] = useState<Job[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [boardRes, offersRes, bookingsRes] = await Promise.all([
          apiRequest<{ jobs: Job[] }>('/api/jobs/board'),
          apiRequest<{ offers: Offer[] }>('/api/offers/my'),
          apiRequest<{ bookings: Booking[] }>('/api/bookings/my?role=worker'),
        ]);
        if (!active) return;
        setBoardJobs(boardRes.jobs);
        setOffers(offersRes.offers);
        setBookings(bookingsRes.bookings);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const acceptedOffers = offers.filter((o) => o.status === 'accepted');
  const activeBookings = bookings.filter((b) =>
    ['pending_payment', 'confirmed', 'in_progress'].includes(b.booking_status),
  );

  return (
    <AppShell mode="worker" title="Worker Dashboard">
      <div className="space-y-6">
        <SetupNotice />

        <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1B25]">
              Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}
            </h1>
            <p className="text-sm text-[#6B7280] mt-1">
              Browse open requests in Benin City, submit competitive offers, and track confirmed bookings.
            </p>
          </div>
          <Link
            to="/worker/jobs"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold whitespace-nowrap shrink-0"
          >
            Browse Job Board
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {!workerProfile && (
          <div className="bg-white rounded-2xl border border-[#FF6B35]/50 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <UserCheck className="w-5 h-5 text-[#FF6B35] shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-bold text-[#1A1B25]">
                  Complete your Worker Profile to submit offers
                </h2>
                <p className="text-xs text-[#6B7280] mt-0.5">
                  Add your bio, service categories, Benin City neighborhoods, and availability.
                </p>
              </div>
            </div>
            <Link
              to="/worker/profile"
              className="px-4 py-2 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-xs font-semibold whitespace-nowrap shrink-0"
            >
              Set Up Worker Profile
            </Link>
          </div>
        )}

        {/* Metrics Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-xs text-[#6B7280]">Available jobs</div>
            <div className="text-2xl font-bold text-[#1A1B25] font-mono-nums mt-1">
              {loading ? '—' : boardJobs.length}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-xs text-[#6B7280]">Submitted offers</div>
            <div className="text-2xl font-bold text-[#635BFF] font-mono-nums mt-1">
              {loading ? '—' : offers.length}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-xs text-[#6B7280]">Accepted offers</div>
            <div className="text-2xl font-bold text-[#00C853] font-mono-nums mt-1">
              {loading ? '—' : acceptedOffers.length}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-xs text-[#6B7280]">Active bookings</div>
            <div className="text-2xl font-bold text-[#FF6B35] font-mono-nums mt-1">
              {loading ? '—' : activeBookings.length}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-xs text-[#6B7280]">Completed jobs</div>
            <div className="text-2xl font-bold text-[#1A1B25] font-mono-nums mt-1">
              {workerStats.completedJobs}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-xs text-[#6B7280]">Average rating</div>
            <div className="text-2xl font-bold text-[#1A1B25] font-mono-nums mt-1 flex items-center gap-1">
              <Star className="w-4 h-4 text-[#FF6B35]" />
              {workerStats.averageRating !== null ? workerStats.averageRating.toFixed(1) : '—'}
            </div>
          </div>
        </div>

        {/* Open Jobs Preview */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#1A1B25]">Latest jobs on the board</h2>
            <Link to="/worker/jobs" className="text-xs font-semibold text-[#635BFF]">
              See all open jobs
            </Link>
          </div>

          {loading ? (
            <div className="h-24 bg-[#F6F7FB] rounded-xl animate-pulse" />
          ) : boardJobs.length === 0 ? (
            <p className="text-sm text-[#6B7280]">
              No open jobs from other customers right now. Check back shortly.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {boardJobs.slice(0, 5).map((job) => (
                <Link
                  key={job.id}
                  to={`/worker/jobs/${job.id}`}
                  className="block py-3.5 hover:bg-[#F6F7FB]/60 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-[#1A1B25]">{job.title}</div>
                      <div className="text-xs text-[#6B7280] mt-0.5">
                        {job.category} · {job.location} · Urgency: {job.urgency} ·{' '}
                        {job.offer_count || 0} offers
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-mono-nums font-semibold text-[#FF6B35]">
                        {job.estimated_min !== null && job.estimated_max !== null
                          ? `Est. ${formatNaira(job.estimated_min)}–${formatNaira(job.estimated_max)}`
                          : job.budget
                            ? `Budget ${formatNaira(job.budget)}`
                            : 'Open quote'}
                      </div>
                      {job.has_my_offer && (
                        <div className="text-[11px] font-medium text-[#635BFF] mt-0.5">
                          Offer submitted ({job.my_offer_status})
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
