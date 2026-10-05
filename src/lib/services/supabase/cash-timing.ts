import type { CashTimingInput } from '@/lib/cash-time';
import { getClient, handleError } from './base';

/** One transaction on the server: existing money RPC plus timestamp and audit. */
export async function recordTimedCash(
  operation: 'invoice' | 'purchase_order' | 'manual' | 'customer_advance' | 'supplier_advance',
  payload: Record<string, unknown>,
  timing: CashTimingInput,
): Promise<Record<string, unknown>> {
  const { data, error } = await getClient().rpc('record_cash_transaction_timed' as never, {
    p_operation: operation,
    p_payload: payload,
    p_occurred_at: timing.occurredAt ?? null,
    p_transaction_date: timing.transactionDate ?? null,
    p_time_reason: timing.timeReason?.trim() || null,
  } as never);
  if (error) handleError(error, 'recordTimedCash.rpc');
  if (!data) throw new Error('Máy chủ không trả về phiếu thu/chi hợp lệ');
  return data as Record<string, unknown>;
}
