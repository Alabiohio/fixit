import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PublicNavbar } from '../../components/PublicNavbar';
import { SetupNotice } from '../../components/SetupNotice';
import { useAuth } from '../../context/AuthContext';
import { getSupabaseClient } from '../../lib/supabase';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { config } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const supabase = await getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase is not configured yet. Add your Supabase keys in .env.');
      }
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authErr) throw authErr;

      const redirect = searchParams.get('redirect');
      navigate(redirect || '/customer/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7FB] flex flex-col">
      <PublicNavbar />
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md space-y-4">
          {config && !config.configuredServices.supabase && <SetupNotice />}

          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-[#1A1B25]">Sign in to FixIt</h1>
              <p className="text-sm text-[#6B7280] mt-1">
                Access your customer jobs, worker offers, and bookings.
              </p>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#FF3B30]">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-[#1A1B25]">Password</label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-[#635BFF] hover:text-[#4A44C6]"
                  >
                    Forgot password?
                  </Link>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                  placeholder="Enter your password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] disabled:opacity-60 text-white text-sm font-semibold transition-colors"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            <div className="text-center text-xs text-[#6B7280] pt-2 border-t border-slate-100">
              New to FixIt?{' '}
              <Link to="/signup" className="font-semibold text-[#635BFF] hover:text-[#4A44C6]">
                Create an account
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultRole = searchParams.get('role') === 'worker' ? 'worker' : 'customer';
  const { config } = useAuth();

  const [roleIntent, setRoleIntent] = useState<'customer' | 'worker'>(defaultRole);
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmationMsg, setConfirmationMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setConfirmationMsg('');
    setLoading(true);
    try {
      const supabase = await getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase is not configured yet. Add your Supabase keys in .env.');
      }

      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            phone_number: phoneNumber.trim(),
          },
        },
      });

      if (signUpErr) throw signUpErr;

      if (data.session) {
        navigate(roleIntent === 'worker' ? '/worker/profile' : '/customer/dashboard', {
          replace: true,
        });
      } else {
        setConfirmationMsg(
          'Account created. Please check your email to verify your address, then sign in.',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7FB] flex flex-col">
      <PublicNavbar />
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md space-y-4">
          {config && !config.configuredServices.supabase && <SetupNotice />}

          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-[#1A1B25]">Create your FixIt account</h1>
              <p className="text-sm text-[#6B7280] mt-1">
                One account lets you hire professionals or offer skilled services.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 p-1 bg-[#F6F7FB] rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setRoleIntent('customer')}
                className={`py-2 px-3 rounded-md text-xs font-semibold transition-colors ${
                  roleIntent === 'customer'
                    ? 'bg-white text-[#1A1B25] shadow-xs'
                    : 'text-[#6B7280] hover:text-[#1A1B25]'
                }`}
              >
                Hire a Professional
              </button>
              <button
                type="button"
                onClick={() => setRoleIntent('worker')}
                className={`py-2 px-3 rounded-md text-xs font-semibold transition-colors ${
                  roleIntent === 'worker'
                    ? 'bg-white text-[#1A1B25] shadow-xs'
                    : 'text-[#6B7280] hover:text-[#1A1B25]'
                }`}
              >
                Work as a Provider
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#FF3B30]">
                {error}
              </div>
            )}

            {confirmationMsg && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                {confirmationMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                  Full name
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                  placeholder={roleIntent === 'worker' ? 'Chidi Okafor' : 'Ada Osagie'}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                  Phone number (protected until booking deposit is confirmed)
                </label>
                <input
                  type="tel"
                  required
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                  placeholder="+234 803 000 0000"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                  Password (minimum 6 characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                  placeholder="Create a secure password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] disabled:opacity-60 text-white text-sm font-semibold transition-colors"
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>

            <div className="text-center text-xs text-[#6B7280] pt-2 border-t border-slate-100">
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-[#635BFF] hover:text-[#4A44C6]">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const supabase = await getSupabaseClient();
      if (!supabase) throw new Error('Supabase is not configured yet.');
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetErr) throw resetErr;
      setMessage('Password reset instructions have been sent to your email.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send reset email.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7FB] flex flex-col">
      <PublicNavbar />
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
          <div>
            <h1 className="text-xl font-bold text-[#1A1B25]">Reset your password</h1>
            <p className="text-sm text-[#6B7280] mt-1">
              Enter your email address and we will send a password reset link.
            </p>
          </div>
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#FF3B30]">
              {error}
            </div>
          )}
          {message && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
              {message}
            </div>
          )}
          <form onSubmit={handleReset} className="space-y-4">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold"
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
          <div className="text-center text-xs">
            <Link to="/login" className="text-[#635BFF] font-semibold">
              Back to Sign In
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const supabase = await getSupabaseClient();
      if (!supabase) throw new Error('Supabase is not configured yet.');
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw updateErr;
      navigate('/customer/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7FB] flex flex-col">
      <PublicNavbar />
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
          <h1 className="text-xl font-bold text-[#1A1B25]">Choose a new password</h1>
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#FF3B30]">
              {error}
            </div>
          )}
          <form onSubmit={handleUpdate} className="space-y-4">
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 6 chars)"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] text-white text-sm font-semibold"
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
