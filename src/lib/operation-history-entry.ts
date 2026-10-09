const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Store calendar date, independent of the cashier device's time zone. */
export function auditStoreDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function billAuditHref(branchId: string | undefined, billId: string | undefined, label: string): string | undefined {
  if (!branchId || !billId || !UUID.test(branchId) || !UUID.test(billId)) return undefined;
  const params = new URLSearchParams({ branch: branchId, bill: billId, label: label.slice(0, 100) });
  return `/he-thong/audit?${params}`;
}

export function auditEntryFilters(params: Pick<URLSearchParams, "get">, now = new Date()) {
  const branch = params.get("branch") ?? "";
  const bill = params.get("bill") ?? "";
  const scopedBill = UUID.test(branch) && UUID.test(bill);
  const today = auditStoreDate(now);
  return {
    branch: scopedBill ? branch : "current",
    search: scopedBill ? bill : "",
    label: scopedBill ? (params.get("label")?.slice(0, 100) || "Bill đang xem") : "",
    source: scopedBill ? "fnb" : "all",
    datePreset: scopedBill ? "all" as const : "today" as const,
    dateFrom: scopedBill ? "" : today,
    dateTo: scopedBill ? "" : today,
  };
}
