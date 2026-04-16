/** Shift management types */

export interface Shift {
  id: string;
  tenantId: string;
  branchId: string;
  cashierId: string;
  cashierName?: string;
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  startingCash: number;
  expectedCash: number | null;
  actualCash: number | null;
  cashDifference: number | null;
  totalSales: number;
  totalOrders: number;
  salesByMethod: Record<string, number>;
  note: string | null;
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
}
