import type { ShiftCloseKind, ShiftTotalsInput } from "@/lib/types/shift";
export const SHIFT_CLOSE_LABELS = { end_of_day: "Chốt cuối ngày — không bàn giao", shift_change: "Kết thúc ca / bàn giao ca sau" };
export function countedAmount(value: string, allowNegative = false): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && Math.abs(amount) <= 1e15 && (allowNegative || amount >= 0) ? amount : null;
}
export function shiftTotalsDraft(preview: {expectedCash: number; salesByMethod: Record<string, number>} | null,
  cash: string, transfer: string, closeKind: ShiftCloseKind, note: string) {
  const actualCash = countedAmount(cash);
  const actualTransfer = countedAmount(transfer, true);
  const expectedTransfer = preview?.salesByMethod.transfer ?? 0;
  const hasDifference = preview != null && actualCash != null && actualTransfer != null &&
    (actualCash !== preview.expectedCash || actualTransfer !== expectedTransfer);
  const valid = !!preview && actualCash != null && actualTransfer != null && (!hasDifference || note.trim().length >= 3);
  const input: ShiftTotalsInput | undefined = valid ? {actualTransfer: actualTransfer!, expectedCash: preview!.expectedCash, expectedTransfer, closeKind} : undefined;
  return { actualCash, actualTransfer, expectedTransfer, hasDifference, valid, input };
}
