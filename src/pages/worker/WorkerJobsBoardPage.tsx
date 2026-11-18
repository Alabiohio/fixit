import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';
import { apiRequest } from '../../lib/api';
import { CATEGORY_NAMES, SUPPORTED_CITIES, formatNaira } from '../../../shared/constants';
import type { Job } from '../../types/bookam';

export function WorkerJobsBoardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (categoryFilter !== 'All') params.set('category', categoryFilter);
    if (locationFilter !== 'All') params.set('location', locationFilter);

    apiRequest<{ jobs: Job[] }>(`/api/jobs/board?${params.toString()}`)
      .then((res) => {
        if (active) setJobs(res.jobs);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load job board.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [categoryFilter, locationFilter]);

  return (
    <AppShell mode="worker" title="Job Board">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1B25]">Available Jobs</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Filter open requests by category or Benin City neighborhood. Customer phone numbers remain protected until booking deposit confirmation.
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-semibold text-[#1A1B25] mb-1">Category</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="All">All categories</option>
              {CATEGORY_NAMES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-semibold text-[#1A1B25] mb-1">Location</label>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="All">All Benin City areas</option>
              {SUPPORTED_CITIES[0].areas.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-[#FF3B30]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            <div className="h-28 bg-white rounded-xl border border-slate-200 animate-pulse" />
            <div className="h-28 bg-white rounded-xl border border-slate-200 animate-pulse" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-[#6B7280]">
            No open jobs match your current filters.
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="text-xs text-[#6B7280]">
                    {job.category} · {job.location} · Urgency: {job.urgency} ·{' '}
                    {job.offer_count || 0} offer{(job.offer_count || 0) === 1 ? '' : 's'}
                  </div>
                  <h2 className="text-base font-bold text-[#1A1B25]">{job.title}</h2>
                  <p className="text-sm text-[#6B7280] line-clamp-2">{job.description}</p>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between gap-3 shrink-0">
                  <div className="text-right">
                    {job.estimated_min !== null && job.estimated_max !== null && (
                      <div className="text-sm font-bold text-[#FF6B35] font-mono-nums">
                        Est. {formatNaira(job.estimated_min)}–{formatNaira(job.estimated_max)}
                      </div>
                    )}
                    {job.budget && (
                      <div className="text-xs text-[#6B7280] font-mono-nums">
                        Customer budget: {formatNaira(job.budget)}
                      </div>
                    )}
                  </div>

                  <Link
                    to={`/worker/jobs/${job.id}`}
                    className="px-4 py-2 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-xs font-semibold whitespace-nowrap"
                  >
                    {job.has_my_offer ? 'View Offer' : 'View & Submit Offer'}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
