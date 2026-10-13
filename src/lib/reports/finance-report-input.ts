export function isFinanceReportDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

export function financeReportRangeError(from: string, to: string): string {
  if (!isFinanceReportDate(from) || !isFinanceReportDate(to)) return "Chọn ngày bắt đầu và kết thúc hợp lệ.";
  return from > to ? "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc." : "";
}

export function financeMoneyCents(amount: number): number {
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(cents)
    || Math.abs(amount * 100 - cents) > 0.00001) {
    throw new Error("Số tiền báo cáo không hợp lệ.");
  }
  return cents;
}
