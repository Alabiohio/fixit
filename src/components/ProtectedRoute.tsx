import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SetupNotice } from './SetupNotice';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { loading, user, config } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7FB] flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-5 text-sm text-[#6B7280]">
          Loading your FixIt workspace...
        </div>
      </div>
    );
  }

  if (config && !config.configuredServices.supabase) {
    return (
      <div className="min-h-screen bg-[#F6F7FB] p-6 flex items-center justify-center">
        <div className="max-w-xl w-full">
          <SetupNotice />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return <>{children}</>;
}
