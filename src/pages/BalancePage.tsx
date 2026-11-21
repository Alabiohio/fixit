import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CircleDollarSign, LockKeyhole } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { apiRequest } from '../lib/api';
import { formatNaira } from '../../shared/constants';
import type { Booking, WalletTransaction } from '../types/bookam';

interface BalancePageProps {
  role: 'customer' | 'worker';
}

interface PaystackBank {
  name: string;
  code: string;
}

interface PaystackPayoutAccount {
  bank_name: string;
  account_name: string;
  account_last4: string;
}

interface WorkerWallet {
  available_balance: number;
}

export function BalancePage({ role }: BalancePageProps) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paystackConfigured, setPaystackConfigured] = useState(false);
  const [payoutAccount, setPayoutAccount] = useState<PaystackPayoutAccount | null>(null);
  const [wallet, setWallet] = useState<WorkerWallet>({ available_balance: 0 });
  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>([]);
  const [banks, setBanks] = useState<PaystackBank[]>([]);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [savingPayoutAccount, setSavingPayoutAccount] = useState(false);
  const [payoutError, setPayoutError] = useState('');
  const [payoutSuccess, setPayoutSuccess] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  async function refreshWallet() {
    const result = await apiRequest<{
      wallet: WorkerWallet;
      transactions: WalletTransaction[];
    }>('/api/worker/wallet');
    if (!result || typeof result !== 'object') {
      throw new Error('The wallet API did not return a JSON object.');
    }
    if (!result.wallet || typeof result.wallet !== 'object') {
      throw new Error('The wallet API response is missing its wallet object.');
    }
    if (!Number.isFinite(Number(result.wallet.available_balance))) {
      throw new Error('The wallet API response has an invalid available balance.');
    }
    if (!Array.isArray(result.transactions)) {
      throw new Error('The wallet API response is missing its transactions list.');
    }
    setWallet(result.wallet);
    setWalletTransactions(result.transactions);
  }

  useEffect(() => {
    let active = true;

    async function loadBookings() {
      try {
        const result = await apiRequest<{ bookings: Booking[] }>(
          `/api/bookings/my?role=${role}`,
        );
        if (!Array.isArray(result.bookings)) {
          throw new Error('The booking summary response from the server was invalid.');
        }
        if (active) setBookings(result.bookings);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load balance summary.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadBookings();
    return () => {
      active = false;
    };
  }, [role]);

  useEffect(() => {
    if (role !== 'worker') return;
    let active = true;

    async function loadPayoutSetup() {
      try {
        const accountResult = await apiRequest<{
          configured: boolean;
          account: PaystackPayoutAccount | null;
        }>('/api/payouts/paystack-account');
        if (active) {
          setPaystackConfigured(accountResult.configured);
          setPayoutAccount(accountResult.account);
        }
      } catch (err) {
        if (active) {
          setPayoutError(err instanceof Error ? err.message : 'Unable to load payout account.');
        }
      }

      try {
        await refreshWallet();
      } catch (err) {
        if (active) {
          setPayoutError(err instanceof Error ? err.message : 'Unable to load wallet balance.');
        }
      }

      try {
        const bankResult = await apiRequest<{ banks: PaystackBank[] }>('/api/paystack/banks');
        if (!Array.isArray(bankResult.banks)) {
          throw new Error('The bank list response from Paystack was invalid.');
        }
        if (active) setBanks(bankResult.banks);
      } catch (err) {
        if (active) {
          setPayoutError(err instanceof Error ? err.message : 'Unable to load Paystack banks.');
        }
      }
    }

    loadPayoutSetup();
    return () => {
      active = false;
    };
  }, [role]);

  async function handleSavePayoutAccount(e: React.FormEvent) {
    e.preventDefault();
    setSavingPayoutAccount(true);
    setPayoutError('');
    setPayoutSuccess('');
    try {
      const result = await apiRequest<{ account: PaystackPayoutAccount }>(
        '/api/payouts/paystack-account',
        {
          method: 'PUT',
          body: JSON.stringify({
            account_number: accountNumber,
            bank_code: bankCode,
          }),
        },
      );
      setPayoutAccount(result.account);
      setAccountNumber('');
      setPayoutSuccess('Bank account verified and saved for Paystack payouts.');
    } catch (err) {
      setPayoutError(err instanceof Error ? err.message : 'Unable to save payout account.');
    } finally {
      setSavingPayoutAccount(false);
    }
  }

  async function handleWithdraw() {
    setWithdrawing(true);
    setPayoutError('');
    setPayoutSuccess('');
    try {
      const result = await apiRequest<{
        withdrawal: { status: WalletTransaction['status'] };
        warning?: string;
      }>('/api/worker/wallet/withdraw', { method: 'POST' });
      await refreshWallet();
      setPayoutSuccess(
        result.warning ||
          (result.withdrawal.status === 'completed'
            ? 'Your wallet withdrawal has been sent to your bank account.'
            : 'Your wallet withdrawal is processing through Paystack.'),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to withdraw wallet funds.';
      try {
        await refreshWallet();
        setPayoutError(message);
      } catch (refreshError) {
        const refreshMessage =
          refreshError instanceof Error ? refreshError.message : 'Unable to refresh wallet balance.';
        setPayoutError(`${message} ${refreshMessage}`);
      }
    } finally {
      setWithdrawing(false);
    }
  }

  const totals = useMemo(() => {
    const activeBookings = bookings.filter((booking) => booking.booking_status !== 'cancelled');
    return {
      paidDeposits: activeBookings
        .filter((booking) => booking.payment_status === 'paid')
        .reduce((sum, booking) => sum + booking.deposit_amount, 0),
      pendingDeposits: activeBookings
        .filter((booking) =>
          ['unpaid', 'pending', 'failed'].includes(booking.payment_status),
        )
        .reduce((sum, booking) => sum + booking.deposit_amount, 0),
      bookingValue: activeBookings.reduce((sum, booking) => sum + booking.agreed_price, 0),
    };
  }, [bookings]);

  const customerView = role === 'customer';

  return (
    <AppShell mode={role} title="Balance">
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-[#635BFF]/10 p-2.5 text-[#635BFF]">
              <CircleDollarSign className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#1A1B25]">Balance overview</h1>
              <p className="text-sm text-[#6B7280] mt-1">
                {customerView
                  ? 'Review deposits and booking totals for your service requests.'
                  : 'Review deposit and booking totals associated with your services.'}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-[#FF3B30]">
            {error}
          </div>
        )}

        <div
          className={`grid grid-cols-1 gap-4 ${
            customerView ? 'sm:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4'
          }`}
        >
          <BalanceCard
            label={customerView ? 'Deposits paid' : 'Customer deposits confirmed'}
            amount={totals.paidDeposits}
            loading={loading}
            accent="text-[#00C853]"
          />
          {!customerView && (
            <BalanceCard
              label="Available wallet balance"
              amount={wallet.available_balance}
              loading={loading}
              accent="text-[#635BFF]"
            />
          )}
          <BalanceCard
            label="Deposits awaiting payment"
            amount={totals.pendingDeposits}
            loading={loading}
            accent="text-[#FF6B35]"
          />
          <BalanceCard
            label="Booking value"
            amount={totals.bookingValue}
            loading={loading}
            accent="text-[#635BFF]"
          />
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <LockKeyhole className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
          <p className="text-xs leading-relaxed text-amber-900">
            Completed bookings automatically credit platform-held funds to the worker wallet
            after the 10% FixIt fee. In-person balance payments go directly to the worker and
            are not credited a second time.
          </p>
        </div>

        {!customerView && (
          <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#1A1B25]">FixIt wallet</h2>
                <p className="text-xs text-[#6B7280] mt-1">
                  Funds are credited after the customer completes the booking and confirms the remaining balance is paid.
                </p>
              </div>
              <button
                type="button"
                disabled={
                  withdrawing ||
                  wallet.available_balance <= 0 ||
                  !paystackConfigured ||
                  !payoutAccount
                }
                onClick={handleWithdraw}
                className="px-4 py-2 rounded-lg bg-[#635BFF] text-white text-xs font-semibold disabled:opacity-50"
              >
                {withdrawing ? 'Requesting withdrawal...' : 'Withdraw available balance'}
              </button>
            </div>
            {!paystackConfigured ? (
              <p className="text-xs text-[#6B7280]">Paystack withdrawals are not configured by FixIt yet.</p>
            ) : !payoutAccount ? (
              <p className="text-xs text-[#6B7280]">Add a verified bank account below to withdraw.</p>
            ) : null}
            {walletTransactions.length === 0 ? (
              <p className="text-xs text-[#6B7280]">Wallet credits and withdrawals will appear here.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {walletTransactions.slice(0, 10).map((transaction) => (
                  <div
                    key={transaction.id}
                    className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-[#1A1B25]">
                        {transaction.transaction_type === 'credit'
                          ? 'Completed booking credit'
                          : 'Paystack withdrawal'}
                      </div>
                      <div className="text-[#6B7280] mt-1">
                        {new Date(transaction.created_at).toLocaleDateString()} ·{' '}
                        <span className="capitalize">{transaction.status}</span>
                        {transaction.failure_reason ? ` · ${transaction.failure_reason}` : ''}
                      </div>
                    </div>
                    <div
                      className={`font-semibold ${
                        transaction.transaction_type === 'credit'
                          ? 'text-emerald-700'
                          : 'text-[#1A1B25]'
                      }`}
                    >
                      {transaction.transaction_type === 'credit' ? '+' : '−'}
                      {formatNaira(transaction.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {!customerView && (
          <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-[#1A1B25]">Paystack payout account</h2>
              <p className="text-xs text-[#6B7280] mt-1">
                Withdrawals from your FixIt wallet are sent to this verified bank account through Paystack.
              </p>
            </div>
            {payoutError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#FF3B30]">
                {payoutError}
              </div>
            )}
            {payoutSuccess && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                {payoutSuccess}
              </div>
            )}
            {!paystackConfigured ? (
              <p className="text-sm text-[#6B7280]">
                Worker payouts are not configured. FixIt must set PAYSTACK_SECRET_KEY on the server.
              </p>
            ) : payoutAccount ? (
              <div className="rounded-lg bg-[#F6F7FB] p-4 text-sm">
                <div className="font-semibold text-[#1A1B25]">{payoutAccount.account_name}</div>
                <div className="text-xs text-[#6B7280] mt-1">
                  {payoutAccount.bank_name} · account ending {payoutAccount.account_last4}
                </div>
                <button
                  type="button"
                  onClick={() => setPayoutAccount(null)}
                  className="mt-3 text-xs font-semibold text-[#635BFF]"
                >
                  Change payout account
                </button>
              </div>
            ) : (
              <form onSubmit={handleSavePayoutAccount} className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-[#1A1B25]">
                  Nigerian bank
                  <select
                    required
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Select a bank</option>
                    {banks.map((bank) => (
                      <option key={bank.code} value={bank.code}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold text-[#1A1B25]">
                  Account number
                  <input
                    required
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{10}"
                    maxLength={10}
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingPayoutAccount || !banks.length}
                  className="sm:col-span-2 justify-self-start px-4 py-2 rounded-lg bg-[#635BFF] text-white text-xs font-semibold disabled:opacity-60"
                >
                  {savingPayoutAccount ? 'Verifying...' : 'Verify and save bank account'}
                </button>
              </form>
            )}
          </section>
        )}

        <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-[#1A1B25]">Bookings</h2>
            <Link
              to={customerView ? '/customer/bookings' : '/worker/bookings'}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#635BFF]"
            >
              Manage bookings <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {loading ? (
            <div className="h-20 rounded-lg bg-[#F6F7FB] animate-pulse" />
          ) : bookings.length === 0 ? (
            <p className="py-6 text-center text-sm text-[#6B7280]">
              Booking totals will appear here when an offer is accepted.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {bookings.map((booking) => (
                <div key={booking.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#1A1B25] truncate">
                      {booking.job?.title || 'Service booking'}
                    </div>
                    <div className="text-xs text-[#6B7280] mt-1">
                      {booking.counterpart?.full_name || 'Booking participant'} ·{' '}
                      {booking.booking_status.replace('_', ' ')}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-semibold text-[#1A1B25]">
                      {formatNaira(booking.deposit_amount)} deposit
                    </div>
                    <div
                      className={`text-[11px] mt-1 ${
                        booking.payment_status === 'paid'
                          ? 'text-[#00C853]'
                          : 'text-[#FF6B35]'
                      }`}
                    >
                      {booking.payment_status === 'paid'
                        ? 'Stripe payment confirmed'
                        : `Payment ${booking.payment_status}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function BalanceCard({
  label,
  amount,
  loading,
  accent,
}: {
  label: string;
  amount: number;
  loading: boolean;
  accent: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="text-xs text-[#6B7280]">{label}</div>
      <div className={`text-2xl font-bold font-mono-nums mt-2 ${accent}`}>
        {loading ? '—' : formatNaira(amount)}
      </div>
    </div>
  );
}
