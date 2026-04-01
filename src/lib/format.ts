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

export function formatPhone(phone: string): string {
  if (phone.length === 10) {
    return `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`;
  }
  return phone;
}
