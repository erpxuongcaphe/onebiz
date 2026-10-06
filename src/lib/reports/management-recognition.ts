export type RecognitionKind = "income" | "expense" | "non_pnl";
export interface RecognitionAllocation {
  branchId: string;
  amount: number;
}
export interface RecognitionEvent {
  id: string;
  kind: RecognitionKind;
  categoryId: string;
  recognitionDate: string;
  amount: number;
  status: "posted" | "cancelled";
  allocations: RecognitionAllocation[];
}
export interface RecognitionSettlement {
  id: string;
  eventId: string;
  cashTransactionId: string;
  paymentDate: string;
  amount: number;
  status: "completed" | "cancelled";
}

function cents(value: number): number {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100))
    || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
    throw new Error("Số tiền không hợp lệ");
  }
  return Math.round(value * 100);
}

function date(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error("Ngày ghi nhận không hợp lệ");
  }
  return value;
}

/** Allocation is a dimension of one event, never an additional expense. */
export function validateRecognitionEvent(event: RecognitionEvent): void {
  date(event.recognitionDate);
  if (!event.id || !event.categoryId || !["income", "expense", "non_pnl"].includes(event.kind)
    || !["posted", "cancelled"].includes(event.status) || cents(event.amount) <= 0) {
    throw new Error("Khoản ghi nhận chưa hợp lệ");
  }
  const branches = new Set<string>();
  let allocated = 0;
  for (const row of event.allocations) {
    if (!row.branchId || branches.has(row.branchId) || cents(row.amount) <= 0) {
      throw new Error("Phân bổ chi nhánh bị trùng hoặc không hợp lệ");
    }
    branches.add(row.branchId);
    allocated += cents(row.amount);
  }
  if (allocated !== cents(event.amount)) throw new Error("Tổng phân bổ phải bằng số tiền ghi nhận");
}

export function summarizeRecognition(
  events: RecognitionEvent[], settlements: RecognitionSettlement[],
  range: { from: string; to: string; branchId?: string },
) {
  const from = date(range.from);
  const to = date(range.to);
  if (from > to) throw new Error("Kỳ báo cáo không hợp lệ");
  const byId = new Map<string, RecognitionEvent>();
  for (const event of events) {
    validateRecognitionEvent(event);
    if (byId.has(event.id)) throw new Error("Nguồn ghi nhận bị trùng");
    byId.set(event.id, event);
  }
  const settlementIds = new Set<string>();
  const cashIds = new Set<string>();
  const paid = new Map<string, number>();
  const paidAtPeriodEnd = new Map<string, number>();
  for (const settlement of settlements) {
    date(settlement.paymentDate);
    const event = byId.get(settlement.eventId);
    if (!event || !settlement.id || !settlement.cashTransactionId || cents(settlement.amount) <= 0
      || !["completed", "cancelled"].includes(settlement.status)
      || settlementIds.has(settlement.id) || cashIds.has(settlement.cashTransactionId)) {
      throw new Error("Liên kết thanh toán không hợp lệ hoặc bị trùng");
    }
    settlementIds.add(settlement.id);
    cashIds.add(settlement.cashTransactionId);
    if (settlement.status === "cancelled") continue;
    if (event.status === "cancelled") throw new Error("Khoản đã hủy còn thanh toán chưa đảo");
    const amount = (paid.get(event.id) ?? 0) + cents(settlement.amount);
    if (amount > cents(event.amount)) throw new Error("Thanh toán vượt số tiền ghi nhận");
    paid.set(event.id, amount);
    if (settlement.paymentDate <= to) {
      paidAtPeriodEnd.set(event.id, (paidAtPeriodEnd.get(event.id) ?? 0) + cents(settlement.amount));
    }
  }
  let income = 0;
  let expense = 0;
  const rows = events.filter(event => event.status === "posted" && event.recognitionDate >= from && event.recognitionDate <= to)
    .flatMap(event => {
      const amount = range.branchId
        ? event.allocations.find(row => row.branchId === range.branchId)?.amount ?? 0 : event.amount;
      if (amount === 0) return [];
      if (event.kind === "income") income += cents(amount);
      if (event.kind === "expense") expense += cents(amount);
      return [{ ...event, reportAmount: amount, settledAmount: (paidAtPeriodEnd.get(event.id) ?? 0) / 100,
        outstandingAmount: (cents(event.amount) - (paidAtPeriodEnd.get(event.id) ?? 0)) / 100 }];
    });
  return { income: income / 100, expense: expense / 100, netResult: (income - expense) / 100, rows };
}
