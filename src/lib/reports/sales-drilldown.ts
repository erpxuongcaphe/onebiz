function dayReportParams(date: string, branchId?: string) {
  const params = new URLSearchParams({
    preset: "custom",
    from: date,
    to: date,
    view: "table",
  });
  if (branchId) params.set("branch", branchId);
  return params;
}

export function buildSalesInvoiceDayLink(date: string, branchId?: string) {
  const params = dayReportParams(date, branchId);
  params.set("detail", "invoices");
  return `/phan-tich/ban-hang?${params.toString()}`;
}

export function buildSalesReturnDayLink(date: string, branchId?: string) {
  return `/phan-tich/tra-hang?${dayReportParams(date, branchId).toString()}`;
}
