export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatShortDate(date: string | Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

/**
 * Format VND for chart axes/tooltips.
 * - >= 1 tỷ: "1,5T"
 * - >= 1 triệu: "45,2M"
 * - >= 1 nghìn: "500K"
 * - otherwise: raw number
 */
export function formatChartCurrency(value: number): string {
  if (value >= 1_000_000_000) {
    const v = value / 1_000_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1).replace(".", ",")}T`;
  }
  if (value >= 1_000_000) {
    const v = value / 1_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1).replace(".", ",")}M`;
  }
  if (value >= 1_000) {
    const v = value / 1_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1).replace(".", ",")}K`;
  }
  return value.toLocaleString("vi-VN");
}

/**
 * Format VND for chart tooltips with full detail, e.g. "45.250.000đ"
 */
export function formatChartTooltipCurrency(value: number): string {
  return new Intl.NumberFormat("vi-VN").format(value) + "đ";
}

export function formatNumber(n: number): string {
  return n.toLocaleString("vi-VN");
}

export function formatPhone(phone: string): string {
  if (phone.length === 10) {
    return `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`;
  }
  return phone;
}

/**
 * Hiển thị tên người tạo đơn/phiếu. Ưu tiên name. Nếu chỉ có UUID → rút gọn.
 * Pattern UUID của Supabase auth.users: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 ký tự).
 * Ta hiện "—" để UX sạch thay vì cipher dài.
 *
 * @example
 *  formatUser(undefined, "Anh Dinh") // "Anh Dinh"
 *  formatUser("a1b2c3d4-e5f6-7890-abcd-ef1234567890") // "—"
 *  formatUser("admin") // "admin"
 */
export function formatUser(name?: string | null, fallback?: string | null): string {
  if (name && name.trim()) return name.trim();
  if (!fallback) return "—";
  const t = fallback.trim();
  // UUID v4/v5 check (8-4-4-4-12)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return "—";
  }
  return t;
}
