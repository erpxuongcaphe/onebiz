/** Cash UI uses the business timezone, never the workstation timezone. */
export const CASH_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export function cashDateTimeInput(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0,16);
}
export function cashInputToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Ngày giờ thu/chi không hợp lệ');
  const date = new Date(value + ':00+07:00');
  if (!Number.isFinite(date.getTime()) || cashDateTimeInput(date) !== value) throw new Error('Ngày giờ thu/chi không hợp lệ');
  return date.toISOString();
}
export function cashBookDate(value: string): string {
  const date = value.slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}
export function formatCashBookDate(value: string): string {
  const date = cashBookDate(value);
  return date ? date.split('-').reverse().join('/') : '—';
}
export function formatCashTime(value?: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Chưa ghi nhận';
  return new Intl.DateTimeFormat('vi-VN',{timeZone:CASH_TIME_ZONE,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date);
}
export interface CashTimingInput { occurredAt?: string | null; transactionDate?: string | null; timeReason?: string | null; }
export function validateCashTime(value: string, transactionDate: string, reason: string, now = new Date()): string | null {
  try {
    const at = cashInputToIso(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate) || cashDateTimeInput(new Date(transactionDate + 'T00:00:00+07:00')).slice(0,10) !== transactionDate) return 'Ngày hạch toán không hợp lệ';
    if (new Date(at).getTime() > now.getTime() + 300000) return 'Thời điểm thu/chi không được ở tương lai';
    if (transactionDate > cashDateTimeInput(now).slice(0,10)) return 'Ngày hạch toán không được ở tương lai';
    if ((transactionDate !== value.slice(0,10) || value.slice(0,10) !== cashDateTimeInput(now).slice(0,10)) && reason.trim().length < 3) return 'Cần ghi lý do khi nhập lùi ngày hoặc hạch toán khác ngày thu/chi';
    return null;
  } catch { return 'Ngày giờ thu/chi không hợp lệ'; }
}
