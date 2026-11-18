import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../lib/api';

export function CustomerNotificationsPage() {
  const navigate = useNavigate();
  const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead } = useAuth();

  return (
    <AppShell mode="customer" title="Notifications">
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1B25]">Notifications</h1>
            <p className="text-sm text-[#6B7280] mt-1">
              Updates about worker offers, deposit confirmations, and booking status changes.
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllNotificationsRead()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-[#1A1B25] hover:bg-[#F6F7FB]"
            >
              <CheckCheck className="w-4 h-4 text-[#635BFF]" />
              Mark all read
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#6B7280]">
              You have no notifications yet.
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={async () => {
                  if (!n.read_at) await markNotificationRead(n.id);
                  if (n.link) navigate(n.link);
                }}
                className={`w-full text-left p-5 hover:bg-[#F6F7FB] transition-colors ${
                  !n.read_at ? 'bg-[#635BFF]/5' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#1A1B25]">{n.title}</span>
                  <span className="text-xs text-[#6B7280]">
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-[#6B7280] mt-1">{n.message}</p>
              </button>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}

export function CustomerSettingsPage() {
  const { profile, refreshMe } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [city, setCity] = useState('Benin City');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setPhoneNumber(profile.phone_number || '');
      setCity(profile.city || 'Benin City');
    }
  }, [profile]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      await apiRequest('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: fullName,
          phone_number: phoneNumber,
          city,
        }),
      });
      await refreshMe();
      setSuccess('Profile settings updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell mode="customer" title="Settings">
      <div className="max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1B25]">Account Settings</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Keep your contact phone number current. It is shared only after verified deposit payment.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#FF3B30]">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            {success}
          </div>
        )}

        <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">Full name</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
              Phone number (protected)
            </label>
            <input
              type="tel"
              required
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">City</label>
            <input
              type="text"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
