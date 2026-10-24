/** Shift management types */

export type ShiftCloseKind = "end_of_day" | "shift_change";
export interface ShiftTotalsInput {
  actualTransfer: number; expectedCash: number; expectedTransfer: number; closeKind: ShiftCloseKind;
}

export interface Shift {
  id: string;
  tenantId: string;
  branchId: string;
  cashierId: string;
  cashierName?: string;
  status: "open" | "closed" | "pending_reconcile";
  openedAt: string;
  closedAt: string | null;
  startingCash: number | null;
  expectedCash: number | null;
  actualCash: number | null;
  cashDifference: number | null;
  totalSales: number | null;
  totalOrders: number | null;
  salesByMethod: Record<string, number> | null;
  note: string | null;
  closeKind?: ShiftCloseKind | null;
  expectedTransfer?: number | null;
  actualTransfer?: number | null;
  transferDifference?: number | null;
}

export interface OpenShiftInput {
  tenantId: string;
  branchId: string;
  cashierId: string;
  startingCash: number;
}

export interface CloseShiftInput {
  shiftId: string;
  actualCash: number;
  note?: string;
  reconciliation?: ShiftTotalsInput;
}
