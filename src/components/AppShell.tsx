import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Briefcase,
  CalendarCheck,
  CheckCheck,
  ClipboardList,
  Compass,
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  Settings,
  UserCheck,
  X,
} from 'lucide-react';
import { Logo } from './Logo';
import { useAuth } from '../context/AuthContext';

interface AppShellProps {
  mode: 'customer' | 'worker';
  title: string;
  children: React.ReactNode;
}

export function AppShell({ mode, title, children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    profile,
    notifications,
    unreadCount,
    markNotificationRead,
    markAllNotificationsRead,
    signOut,
  } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const customerNav = [
    { label: 'Dashboard', to: '/customer/dashboard', icon: LayoutDashboard },
    { label: 'Post a Job', to: '/customer/jobs/new', icon: PlusCircle },
    { label: 'My Jobs', to: '/customer/jobs', icon: ClipboardList },
    { label: 'Bookings', to: '/customer/bookings', icon: CalendarCheck },
    { label: 'Notifications', to: '/customer/notifications', icon: Bell },
    { label: 'Settings', to: '/customer/settings', icon: Settings },
  ];

  const workerNav = [
    { label: 'Dashboard', to: '/worker/dashboard', icon: LayoutDashboard },
    { label: 'Job Board', to: '/worker/jobs', icon: Compass },
    { label: 'My Offers', to: '/worker/offers', icon: Briefcase },
    { label: 'Bookings', to: '/worker/bookings', icon: CalendarCheck },
    { label: 'Notifications', to: '/worker/notifications', icon: Bell },
    { label: 'Worker Profile', to: '/worker/profile', icon: UserCheck },
  ];

  const navItems = mode === 'customer' ? customerNav : workerNav;

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-[#F6F7FB] flex flex-col">
      {/* Dark Navy Top Bar */}
      <header className="bg-[#1A1B25] text-white border-b border-white/10 h-16 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-40">
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={() => setSidebarOpen((s) => !s)}
            className="lg:hidden p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10"
            aria-label="Toggle workspace menu"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <Logo to={mode === 'customer' ? '/customer/dashboard' : '/worker/dashboard'} />
          <span className="hidden sm:inline text-white/30">/</span>
          <span className="hidden sm:inline text-sm text-white/80 truncate">{title}</span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Role Mode Switcher (same account supports both Customer & Worker) */}
          <div className="hidden sm:flex items-center bg-white/10 rounded-lg p-1 text-xs font-medium">
            <Link
              to="/customer/dashboard"
              className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                mode === 'customer'
                  ? 'bg-[#635BFF] text-white'
                  : 'text-white/75 hover:text-white'
              }`}
            >
              Customer
            </Link>
            <Link
              to="/worker/dashboard"
              className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                mode === 'worker'
                  ? 'bg-[#635BFF] text-white'
                  : 'text-white/75 hover:text-white'
              }`}
            >
              Worker
            </Link>
          </div>

          {/* Notification Bell */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen((prev) => !prev)}
              className="relative p-2 rounded-lg text-white/85 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF6B35] text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white text-[#1A1B25] rounded-xl border border-slate-200 shadow-lg overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-sm font-semibold">Notifications</span>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => markAllNotificationsRead()}
                      className="text-xs font-medium text-[#635BFF] hover:text-[#4A44C6] inline-flex items-center gap-1"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-sm text-[#6B7280]">
                      No notifications yet.
                    </div>
                  ) : (
                    notifications.slice(0, 8).map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={async () => {
                          if (!n.read_at) await markNotificationRead(n.id);
                          setNotifOpen(false);
                          if (n.link) navigate(n.link);
                        }}
                        className={`w-full text-left px-4 py-3 hover:bg-[#F6F7FB] transition-colors ${
                          !n.read_at ? 'bg-[#635BFF]/5' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#1A1B25]">{n.title}</span>
                          {!n.read_at && (
                            <span className="text-[11px] font-medium text-[#635BFF]">New</span>
                          )}
                        </div>
                        <p className="text-xs text-[#6B7280] mt-1 line-clamp-2">{n.message}</p>
                      </button>
                    ))
                  )}
                </div>
                <div className="px-4 py-2.5 bg-[#F6F7FB] border-t border-slate-100 text-center">
                  <Link
                    to={mode === 'customer' ? '/customer/notifications' : '/worker/notifications'}
                    onClick={() => setNotifOpen(false)}
                    className="text-xs font-semibold text-[#635BFF] hover:text-[#4A44C6]"
                  >
                    View all notifications
                  </Link>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar Navigation */}
        <aside
          className={`${
            sidebarOpen ? 'fixed inset-y-16 left-0 z-30 block' : 'hidden'
          } lg:static lg:block w-64 bg-white border-r border-slate-200 shrink-0`}
        >
          <div className="p-5 border-b border-slate-100">
            <div className="text-xs text-[#6B7280]">Signed in as</div>
            <div className="text-sm font-semibold text-[#1A1B25] truncate mt-0.5">
              {profile?.full_name || profile?.email || 'FixIt Account'}
            </div>
            <div className="text-xs text-[#6B7280] mt-1">
              {profile?.city || 'Benin City'} · {mode === 'customer' ? 'Customer view' : 'Worker view'}
            </div>
          </div>

          <div className="sm:hidden p-3 border-b border-slate-100 flex gap-2">
            <Link
              to="/customer/dashboard"
              onClick={() => setSidebarOpen(false)}
              className={`flex-1 text-center py-2 rounded-lg text-xs font-semibold ${
                mode === 'customer'
                  ? 'bg-[#635BFF] text-white'
                  : 'bg-[#F6F7FB] text-[#1A1B25]'
              }`}
            >
              Customer
            </Link>
            <Link
              to="/worker/dashboard"
              onClick={() => setSidebarOpen(false)}
              className={`flex-1 text-center py-2 rounded-lg text-xs font-semibold ${
                mode === 'worker'
                  ? 'bg-[#635BFF] text-white'
                  : 'bg-[#F6F7FB] text-[#1A1B25]'
              }`}
            >
              Worker
            </Link>
          </div>

          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                location.pathname === item.to ||
                (item.to !== '/customer/dashboard' &&
                  item.to !== '/worker/dashboard' &&
                  location.pathname.startsWith(item.to + '/'));

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#635BFF]/10 text-[#635BFF]'
                      : 'text-[#6B7280] hover:text-[#1A1B25] hover:bg-[#F6F7FB]'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  {item.label === 'Notifications' && unreadCount > 0 && (
                    <span className="text-xs font-semibold text-[#FF6B35] tabular-nums">
                      {unreadCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="p-4 mt-4 border-t border-slate-100 lg:hidden">
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium text-[#FF3B30] hover:bg-red-50"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </aside>

        {/* Main Viewport */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-6xl">
          {children}
        </main>
      </div>
    </div>
  );
}
