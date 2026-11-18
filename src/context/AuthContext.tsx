import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { apiRequest } from '../lib/api';
import { getSupabaseClient, loadAppConfig } from '../lib/supabase';
import type {
  AppConfig,
  AppNotification,
  Profile,
  WorkerProfile,
  WorkerStats,
} from '../types/bookam';

interface AuthContextValue {
  loading: boolean;
  config: AppConfig | null;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  workerProfile: WorkerProfile | null;
  workerStats: WorkerStats;
  notifications: AppNotification[];
  unreadCount: number;
  refreshMe: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workerProfile, setWorkerProfile] = useState<WorkerProfile | null>(null);
  const [workerStats, setWorkerStats] = useState<WorkerStats>({
    averageRating: null,
    reviewCount: 0,
    completedJobs: 0,
  });
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshMe = useCallback(async () => {
    try {
      const data = await apiRequest<{
        profile: Profile;
        workerProfile: WorkerProfile | null;
        workerStats: WorkerStats;
      }>('/api/me');
      setProfile(data.profile);
      setWorkerProfile(data.workerProfile);
      setWorkerStats(data.workerStats);
    } catch {
      setProfile(null);
      setWorkerProfile(null);
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const data = await apiRequest<{
        notifications: AppNotification[];
        unreadCount: number;
      }>('/api/notifications');
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // Ignore if unauthenticated
    }
  }, []);

  const markNotificationRead = useCallback(async (id: string) => {
    await apiRequest(`/api/notifications/${id}/read`, { method: 'PATCH' });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  const markAllNotificationsRead = useCallback(async () => {
    await apiRequest('/api/notifications/read-all', { method: 'POST' });
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })),
    );
    setUnreadCount(0);
  }, []);

  const signOut = useCallback(async () => {
    const supabase = await getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setUser(null);
    setProfile(null);
    setWorkerProfile(null);
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;

    async function init() {
      try {
        const appCfg = await loadAppConfig();
        if (!active) return;
        setConfig(appCfg);

        const supabase = await getSupabaseClient();
        if (!supabase) {
          setLoading(false);
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (!active) return;

        setSession(data.session);
        setUser(data.session?.user ?? null);

        if (data.session?.user) {
          await Promise.all([refreshMe(), refreshNotifications()]);
        }

        const authListener = supabase.auth.onAuthStateChange(async (_event, newSession) => {
          if (!active) return;
          setSession(newSession);
          setUser(newSession?.user ?? null);
          if (newSession?.user) {
            await Promise.all([refreshMe(), refreshNotifications()]);
          } else {
            setProfile(null);
            setWorkerProfile(null);
            setNotifications([]);
            setUnreadCount(0);
          }
        });

        subscription = authListener.data.subscription;
      } finally {
        if (active) setLoading(false);
      }
    }

    init();

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [refreshMe, refreshNotifications]);

  // Supabase Realtime subscription for notifications when authenticated
  useEffect(() => {
    if (!user) return;

    let channel: ReturnType<NonNullable<Awaited<ReturnType<typeof getSupabaseClient>>>['channel']> | null =
      null;
    let active = true;

    async function subscribeRealtime() {
      const supabase = await getSupabaseClient();
      if (!supabase || !active || !user) return;

      channel = supabase
        .channel(`bookam-notifications-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const incoming = payload.new as AppNotification;
            setNotifications((prev) => [incoming, ...prev]);
            setUnreadCount((prev) => prev + 1);
          },
        )
        .subscribe();
    }

    subscribeRealtime();

    return () => {
      active = false;
      if (channel) {
        getSupabaseClient().then((supabase) => {
          if (supabase && channel) {
            supabase.removeChannel(channel);
          }
        });
      }
    };
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        loading,
        config,
        session,
        user,
        profile,
        workerProfile,
        workerStats,
        notifications,
        unreadCount,
        refreshMe,
        refreshNotifications,
        markNotificationRead,
        markAllNotificationsRead,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
