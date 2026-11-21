import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck, ImagePlus, Star, User } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../lib/api';
import { CATEGORY_NAMES, SUPPORTED_CITIES } from '../../../shared/constants';

export function WorkerNotificationsPage() {
  const navigate = useNavigate();
  const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead } = useAuth();

  return (
    <AppShell mode="worker" title="Notifications">
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1B25]">Worker Notifications</h1>
            <p className="text-sm text-[#6B7280] mt-1">
              Alerts when offers are accepted, deposits are verified, or bookings change.
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllNotificationsRead()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-[#1A1B25]"
            >
              <CheckCheck className="w-4 h-4 text-[#635BFF]" />
              Mark all read
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#6B7280]">
              No notifications yet.
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

export function WorkerProfilePage() {
  const { profile, workerProfile, workerStats, refreshMe } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [address, setAddress] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [bio, setBio] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['Plumbing']);
  const [selectedLocations, setSelectedLocations] = useState<string[]>(['Ugbowo']);
  const [availability, setAvailability] = useState('Available Mon–Sat, 8am–6pm');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setPhoneNumber(profile.phone_number || '');
      setAddress(profile.address || '');
      setAvatarUrl(profile.avatar_url || '');
    }
    if (workerProfile) {
      setBio(workerProfile.bio || '');
      setSelectedCategories(
        workerProfile.service_categories?.length ? workerProfile.service_categories : ['Plumbing'],
      );
      setSelectedLocations(
        workerProfile.service_locations?.length ? workerProfile.service_locations : ['Ugbowo'],
      );
      setAvailability(workerProfile.availability || 'Available this week');
    }
  }, [profile, workerProfile]);

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  function toggleLocation(area: string) {
    setSelectedLocations((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area],
    );
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setError('Profile photo must be 3MB or smaller.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read image.'));
        reader.readAsDataURL(file);
      });
      const res = await apiRequest<{ url: string }>('/api/uploads', {
        method: 'POST',
        body: JSON.stringify({ dataUrl, folder: 'avatars', fileName: file.name }),
      });
      setAvatarUrl(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload avatar.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (selectedCategories.length === 0) {
      setError('Select at least one service category.');
      return;
    }
    if (selectedLocations.length === 0) {
      setError('Select at least one Benin City neighborhood.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await apiRequest('/api/worker/profile', {
        method: 'PUT',
        body: JSON.stringify({
          full_name: fullName,
          phone_number: phoneNumber,
          address,
          avatar_url: avatarUrl,
          bio,
          service_categories: selectedCategories,
          service_locations: selectedLocations,
          availability,
        }),
      });
      await refreshMe();
      setSuccess('Worker profile saved. You can now submit offers on available jobs.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save worker profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell mode="worker" title="Worker Profile">
      <div className="max-w-2xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1B25]">Worker Profile</h1>
            <p className="text-sm text-[#6B7280] mt-1">
              Customers see your photo, biography, categories, and verified rating when reviewing offers.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-2 text-xs flex items-center gap-2">
            <Star className="w-4 h-4 text-[#FF6B35]" />
            <span className="font-mono-nums font-semibold">
              {workerStats.averageRating !== null
                ? `${workerStats.averageRating.toFixed(1)} (${workerStats.reviewCount} reviews)`
                : 'No reviews yet'}
            </span>
          </div>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-[#FF3B30]">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            {success}
          </div>
        )}

        <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-[#F6F7FB] border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={fullName || 'Worker avatar'}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-6 h-6 text-[#6B7280]" />
              )}
            </div>
            <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 hover:bg-[#F6F7FB] text-xs font-semibold text-[#1A1B25] cursor-pointer">
              <ImagePlus className="w-4 h-4 text-[#635BFF]" />
              <span>{uploading ? 'Uploading...' : 'Upload profile photo'}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarUpload}
                className="hidden"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                Phone number (unlocked only after payment)
              </label>
              <input
                type="tel"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
              Service address (unlocked only after deposit)
            </label>
            <input
              type="text"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street and area in Benin City"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
              Professional biography
            </label>
            <textarea
              rows={3}
              required
              minLength={10}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Describe your experience, tools, and areas of expertise in Benin City..."
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1B25] mb-2">
              Service categories
            </label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_NAMES.map((cat) => {
                const active = selectedCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-[#635BFF] border-[#635BFF] text-white'
                        : 'bg-white border-slate-300 text-[#1A1B25] hover:bg-[#F6F7FB]'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1B25] mb-2">
              Service locations (Benin City)
            </label>
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_CITIES[0].areas.map((area) => {
                const active = selectedLocations.includes(area);
                return (
                  <button
                    key={area}
                    type="button"
                    onClick={() => toggleLocation(area)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-[#635BFF] border-[#635BFF] text-white'
                        : 'bg-white border-slate-300 text-[#1A1B25] hover:bg-[#F6F7FB]'
                    }`}
                  >
                    {area}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
              Availability
            </label>
            <input
              type="text"
              required
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] disabled:opacity-60 text-white text-sm font-semibold"
          >
            {saving ? 'Saving profile...' : 'Save Worker Profile'}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
