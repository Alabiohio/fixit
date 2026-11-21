import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPaystackSecretKey } from './config.ts';

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

interface PaystackBank {
  name: string;
  code: string;
  active?: boolean;
  currency?: string;
}

interface PaystackAccountResolution {
  account_number: string;
  account_name: string;
}

interface PaystackRecipient {
  recipient_code: string;
  details: {
    account_number: string;
    account_name: string;
    bank_name: string;
    bank_code: string;
  };
}

export interface PaystackTransferResult {
  reference: string;
  transfer_code: string;
  status: string;
  amount: number;
  currency: string;
}

export class PaystackTransportError extends Error {
  constructor() {
    super(
      'Paystack request could not be reached. If this was a transfer, verify it in the Paystack dashboard before retrying.',
    );
    this.name = 'PaystackTransportError';
  }
}

async function paystackRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {},
): Promise<T> {
  const secretKey = getPaystackSecretKey();
  if (!secretKey) {
    throw new Error('PAYSTACK_NOT_CONFIGURED');
  }

  let response: Response;
  try {
    response = await fetch(`https://api.paystack.co${path}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new PaystackTransportError();
  }

  let payload: PaystackEnvelope<T>;
  try {
    payload = (await response.json()) as PaystackEnvelope<T>;
  } catch {
    throw new Error(`Paystack returned an invalid response (${response.status}).`);
  }

  if (!response.ok || !payload.status) {
    throw new Error(payload.message || `Paystack request failed (${response.status}).`);
  }

  return payload.data;
}

export async function listPaystackNigerianBanks(): Promise<Array<{ name: string; code: string }>> {
  const banks = await paystackRequest<PaystackBank[]>('/bank?currency=NGN');
  return banks
    .filter((bank) => bank.code && bank.name && bank.active !== false)
    .map(({ name, code }) => ({ name, code }));
}

export async function createPaystackRecipient(params: {
  accountNumber: string;
  bankCode: string;
}): Promise<{
  recipientCode: string;
  bankName: string;
  accountName: string;
  accountLast4: string;
  bankCode: string;
}> {
  const query = new URLSearchParams({
    account_number: params.accountNumber,
    bank_code: params.bankCode,
  });
  const account = await paystackRequest<PaystackAccountResolution>(
    `/bank/resolve?${query.toString()}`,
  );
  if (!account.account_name) {
    throw new Error('Paystack could not verify this bank account.');
  }

  const recipient = await paystackRequest<PaystackRecipient>('/transferrecipient', {
    method: 'POST',
    body: {
      type: 'nuban',
      name: account.account_name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: 'NGN',
    },
  });

  return {
    recipientCode: recipient.recipient_code,
    bankName: recipient.details.bank_name,
    accountName: recipient.details.account_name || account.account_name,
    accountLast4: params.accountNumber.slice(-4),
    bankCode: params.bankCode,
  };
}

export function createPaystackTransfer(params: {
  amountNgn: number;
  recipientCode: string;
  reference: string;
  reason: string;
}): Promise<PaystackTransferResult> {
  return paystackRequest<PaystackTransferResult>('/transfer', {
    method: 'POST',
    body: {
      source: 'balance',
      amount: Math.round(params.amountNgn * 100),
      recipient: params.recipientCode,
      reference: params.reference,
      reason: params.reason,
    },
  });
}

export async function handlePaystackTransferWebhook(
  rawBody: Buffer,
  signature: string,
  supabaseAdmin: SupabaseClient,
): Promise<{ received: true; updated: boolean }> {
  const secretKey = getPaystackSecretKey();
  if (!secretKey) {
    throw new Error('PAYSTACK_NOT_CONFIGURED');
  }

  const expectedSignature = createHmac('sha512', secretKey).update(rawBody).digest('hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const receivedBuffer = Buffer.from(signature, 'hex');
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new Error('Invalid Paystack webhook signature.');
  }

  let event: {
    event?: string;
    data?: { reference?: string; transfer_code?: string; reason?: string };
  };
  try {
    event = JSON.parse(rawBody.toString('utf8')) as typeof event;
  } catch {
    throw new Error('Invalid Paystack webhook JSON.');
  }

  const status =
    event.event === 'transfer.success'
      ? 'completed'
      : event.event === 'transfer.failed' || event.event === 'transfer.reversed'
        ? 'failed'
        : undefined;
  const reference = event.data?.reference;
  if (!status || !reference) {
    return { received: true, updated: false };
  }

  const { data: walletResult, error: walletError } = await supabaseAdmin.rpc(
    'finalize_worker_wallet_withdrawal',
    {
      p_reference: reference,
      p_status: status,
      p_transfer_code: event.data?.transfer_code || null,
      p_failure_reason: event.data?.reason || '',
      p_allow_reversal: event.event === 'transfer.reversed',
    },
  );
  if (walletError) {
    throw new Error(`Could not record wallet withdrawal result: ${walletError.message}`);
  }
  const walletUpdate = Array.isArray(walletResult) ? walletResult[0] : walletResult;

  const update: Record<string, string> = {
    status: status === 'completed' ? 'success' : 'failed',
    failure_reason: status === 'failed' ? event.data?.reason || 'Paystack transfer failed.' : '',
  };
  if (event.data?.transfer_code) update.transfer_code = event.data.transfer_code;
  const allowedPreviousStatuses =
    event.event === 'transfer.reversed' ? ['pending', 'success'] : ['pending'];

  const { data: payout, error } = await supabaseAdmin
    .from('worker_payouts')
    .update(update)
    .eq('reference', reference)
    .in('status', allowedPreviousStatuses)
    .select('worker_id, amount, booking_id')
    .maybeSingle();

  if (error) {
    throw new Error(`Could not record Paystack transfer result: ${error.message}`);
  }

  if (walletUpdate?.changed) {
    await supabaseAdmin.from('notifications').insert({
      user_id: walletUpdate.worker_id,
      title: status === 'completed' ? 'Wallet withdrawal sent' : 'Wallet withdrawal failed',
      message:
        status === 'completed'
          ? `Your Paystack wallet withdrawal of ₦${Number(walletUpdate.amount).toLocaleString('en-NG')} has completed.`
          : `Your Paystack wallet withdrawal did not complete. The funds were returned to your FixIt wallet. ${event.data?.reason || ''}`,
      type: 'worker_wallet_withdrawal',
      link: '/worker/balance',
    });
  } else if (payout) {
    await supabaseAdmin.from('notifications').insert({
      user_id: payout.worker_id,
      title: status === 'completed' ? 'Payout sent' : 'Payout failed',
      message:
        status === 'completed'
          ? `Your Paystack transfer of ₦${payout.amount.toLocaleString('en-NG')} has completed.`
          : `Your Paystack transfer did not complete. ${event.data?.reason || 'You can retry from your bookings.'}`,
      type: 'worker_payout',
      link: '/worker/bookings',
    });
  }

  return { received: true, updated: Boolean(walletUpdate?.changed || payout) };
}
