import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { apiRequest } from '../../lib/api';
import { formatNaira } from '../../../shared/constants';
import type { Job } from '../../types/FixIt';

export function CustomerJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiRequest<{ jobs: Job[] }>('/api/jobs/my')
      .then((res) => {
        if (active) setJobs(res.jobs);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load jobs.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = filter === 'all' ? jobs : jobs.filter((j) => j.status === filter);

  return (
    <AppShell mode="customer" title="My Jobs">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1B25]">My Jobs</h1>
            <p className="text-sm text-[#6B7280] mt-1">
              Open any job to review worker offers and compare prices.
            </p>
          </div>
          <Link
            to="/customer/jobs/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold whitespace-nowrap"
          >
            <PlusCircle className="w-4 h-4" />
            Post a Job
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg w-fit">
          {['all', 'open', 'assigned', 'in_progress', 'completed', 'cancelled'].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                filter === status
                  ? 'bg-[#635BFF] text-white'
                  : 'text-[#6B7280] hover:text-[#1A1B25]'
              }`}
            >
              {status.replace('_', ' ')}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-[#FF3B30]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            <div className="h-24 bg-white rounded-xl border border-slate-200 animate-pulse" />
            <div className="h-24 bg-white rounded-xl border border-slate-200 animate-pulse" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
            <p className="text-sm text-[#6B7280]">No jobs match this filter.</p>
            <Link
              to="/customer/jobs/new"
              className="inline-block px-4 py-2 rounded-lg bg-[#635BFF] text-white text-sm font-semibold"
            >
              Post a Job
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((job) => (
              <Link
                key={job.id}
                to={`/customer/jobs/${job.id}`}
                className="block bg-white rounded-xl border border-slate-200 p-5 hover:border-[#635BFF]/50 transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-[#1A1B25]">{job.title}</h2>
                    <div className="text-xs text-[#6B7280]">
                      {job.category} · {job.location} · Urgency: {job.urgency} · Posted{' '}
                      {new Date(job.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex sm:flex-col sm:items-end justify-between gap-2 shrink-0">
                    <div className="text-sm font-semibold text-[#635BFF] font-mono-nums">
                      {job.offer_count || 0} offer{(job.offer_count || 0) === 1 ? '' : 's'}
                    </div>
                    <div className="text-xs text-[#6B7280] font-mono-nums">
                      {job.estimated_min !== null && job.estimated_max !== null
                        ? `Est. ${formatNaira(job.estimated_min)}–${formatNaira(job.estimated_max)}`
                        : job.budget
                          ? `Budget ${formatNaira(job.budget)}`
                          : 'No estimate'}
                      {' · '}
                      <span className="capitalize font-medium text-[#1A1B25]">
                        {job.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
