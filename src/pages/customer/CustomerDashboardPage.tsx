import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PlusCircle } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { SetupNotice } from '../../components/SetupNotice';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../lib/api';
import { formatNaira } from '../../../shared/constants';
import type { Booking, Job } from '../../types/FixIt';

export function CustomerDashboardPage() {
  const { profile, notifications } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [jobsRes, bookingsRes] = await Promise.all([
          apiRequest<{ jobs: Job[] }>('/api/jobs/my'),
          apiRequest<{ bookings: Booking[] }>('/api/bookings/my?role=customer'),
        ]);
        if (!active) return;
        setJobs(jobsRes.jobs);
        setBookings(bookingsRes.bookings);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load dashboard.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const activeJobs = jobs.filter((j) => j.status === 'open' || j.status === 'assigned' || j.status === 'in_progress');
  const pendingOffersCount = jobs.reduce((acc, j) => acc + (j.pending_offer_count || 0), 0);
  const confirmedBookings = bookings.filter((b) =>
    ['confirmed', 'in_progress'].includes(b.booking_status),
  );
  const awaitingPayment = bookings.filter(
    (b) => b.payment_status !== 'paid' && b.booking_status !== 'cancelled',
  );

  return (
    <AppShell mode="customer" title="Customer Dashboard">
      <div className="space-y-6">
        <SetupNotice />

        {/* Welcome Header */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1B25]">
              Welcome back{profile?.full_name ? `, ${profile.full_name}` : ''}
            </h1>
            <p className="text-sm text-[#6B7280] mt-1">
              Manage your local service requests, compare offers, and confirm bookings in {profile?.city || 'Benin City'}.
            </p>
          </div>
          <Link
            to="/customer/jobs/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <PlusCircle className="w-4 h-4" />
            Post a Job
          </Link>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-[#FF3B30]">
            {error}
          </div>
        )}

        {/* KPI Summary Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="text-xs text-[#6B7280]">Active jobs</div>
            <div className="text-2xl font-bold text-[#1A1B25] font-mono-nums mt-1">
              {loading ? '—' : activeJobs.length}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="text-xs text-[#6B7280]">Pending offers</div>
            <div className="text-2xl font-bold text-[#635BFF] font-mono-nums mt-1">
              {loading ? '—' : pendingOffersCount}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="text-xs text-[#6B7280]">Confirmed bookings</div>
            <div className="text-2xl font-bold text-[#00C853] font-mono-nums mt-1">
              {loading ? '—' : confirmedBookings.length}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="text-xs text-[#6B7280]">Awaiting deposit</div>
            <div className="text-2xl font-bold text-[#FF6B35] font-mono-nums mt-1">
              {loading ? '—' : awaitingPayment.length}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Active Jobs */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#1A1B25]">Your active jobs</h2>
              <Link
                to="/customer/jobs"
                className="text-xs font-semibold text-[#635BFF] hover:text-[#4A44C6]"
              >
                View all jobs
              </Link>
            </div>

            {loading ? (
              <div className="space-y-3">
                <div className="h-16 bg-[#F6F7FB] rounded-lg animate-pulse" />
                <div className="h-16 bg-[#F6F7FB] rounded-lg animate-pulse" />
              </div>
            ) : activeJobs.length === 0 ? (
              <div className="py-8 text-center space-y-3 bg-[#F6F7FB] rounded-xl border border-slate-100">
                <p className="text-sm text-[#6B7280]">You have no active jobs right now.</p>
                <Link
                  to="/customer/jobs/new"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#635BFF]"
                >
                  Post your first job
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {activeJobs.slice(0, 5).map((job) => (
                  <Link
                    key={job.id}
                    to={`/customer/jobs/${job.id}`}
                    className="block py-3.5 hover:bg-[#F6F7FB]/60 -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#1A1B25] truncate">
                          {job.title}
                        </div>
                        <div className="text-xs text-[#6B7280] mt-1">
                          {job.category} · {job.location} · Status: {job.status}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-semibold text-[#635BFF] font-mono-nums">
                          {job.offer_count || 0} offer{(job.offer_count || 0) === 1 ? '' : 's'}
                        </div>
                        {job.estimated_min !== null && job.estimated_max !== null && (
                          <div className="text-xs text-[#6B7280] font-mono-nums mt-0.5">
                            Est. {formatNaira(job.estimated_min)}–{formatNaira(job.estimated_max)}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Bookings & Notifications */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[#1A1B25]">Recent bookings</h2>
                <Link
                  to="/customer/bookings"
                  className="text-xs font-semibold text-[#635BFF] hover:text-[#4A44C6]"
                >
                  Manage bookings
                </Link>
              </div>

              {loading ? (
                <div className="h-20 bg-[#F6F7FB] rounded-lg animate-pulse" />
              ) : bookings.length === 0 ? (
                <p className="text-sm text-[#6B7280]">
                  Bookings appear here once you accept a worker's offer.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {bookings.slice(0, 3).map((b) => (
                    <div key={b.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#1A1B25] truncate">
                          {b.job?.title || 'Service Booking'}
                        </div>
                        <div className="text-xs text-[#6B7280] mt-0.5">
                          {b.counterpart?.full_name} · {b.booking_status.replace('_', ' ')}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-mono-nums font-semibold text-[#1A1B25]">
                          {formatNaira(b.agreed_price)}
                        </div>
                        <div
                          className={`text-[11px] font-medium ${
                            b.payment_status === 'paid' ? 'text-[#00C853]' : 'text-[#FF6B35]'
                          }`}
                        >
                          {b.payment_status === 'paid' ? 'Deposit paid' : 'Deposit pending'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[#1A1B25]">Recent notifications</h2>
                <Link
                  to="/customer/notifications"
                  className="text-xs font-semibold text-[#635BFF] hover:text-[#4A44C6]"
                >
                  View all
                </Link>
              </div>
              {notifications.length === 0 ? (
                <p className="text-sm text-[#6B7280]">No notifications yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {notifications.slice(0, 3).map((n) => (
                    <div key={n.id} className="p-3 rounded-lg bg-[#F6F7FB] text-xs">
                      <div className="font-semibold text-[#1A1B25]">{n.title}</div>
                      <div className="text-[#6B7280] mt-0.5">{n.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
