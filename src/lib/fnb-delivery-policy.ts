/** Ranges are [from, to): one unambiguous rule at every boundary. */
export interface DeliveryPriceRule {
  id: string;
  name: string;
  fromMeters: number;
  toMeters: number | null;
  fromAmount: number;
  toAmount: number | null;
  fee: number;
  enabled: boolean;
}

export interface DeliveryPricePolicy {
  revision: number;
  enabled: boolean;
  amountBasis: "before_discount" | "after_discount";
  rules: DeliveryPriceRule[];
}

export const EMPTY_DELIVERY_POLICY: DeliveryPricePolicy = {
  revision: 0, enabled: false, amountBasis: "after_discount", rules: [],
};

export function validateDeliveryPolicy(policy: DeliveryPricePolicy): string | null {
  if (!["before_discount", "after_discount"].includes(policy.amountBasis)) return "Chọn cách tính giá trị bill.";
  if (policy.rules.length > 100) return "Tối đa 100 mức phí.";
  const ids = new Set<string>();
  for (const rule of policy.rules) {
    if (!rule.id || ids.has(rule.id) || !rule.name.trim() || rule.name.length > 120) return "Mỗi mức cần tên riêng, tối đa 120 ký tự.";
    ids.add(rule.id);
    if ([rule.fromMeters, rule.fromAmount, rule.fee].some(n => !Number.isSafeInteger(n) || n < 0)
      || (rule.toMeters !== null && (!Number.isSafeInteger(rule.toMeters) || rule.toMeters <= rule.fromMeters))
      || (rule.toAmount !== null && (!Number.isSafeInteger(rule.toAmount) || rule.toAmount <= rule.fromAmount))) {
      return `Kiểm tra khoảng cách, ngưỡng tiền và phí của “${rule.name}”.`;
    }
  }
  const active = policy.rules.filter(r => r.enabled);
  if (policy.enabled && active.length === 0) return "Thêm ít nhất một mức đang bật trước khi áp dụng tự động.";
  for (let i = 0; i < active.length; i++) {
    for (const b of active.slice(i + 1)) {
      const a = active[i];
      if (a.fromMeters < (b.toMeters ?? Infinity) && b.fromMeters < (a.toMeters ?? Infinity)
        && a.fromAmount < (b.toAmount ?? Infinity) && b.fromAmount < (a.toAmount ?? Infinity)) {
        return `“${a.name}” và “${b.name}” trùng điều kiện. Tách khoảng cách hoặc ngưỡng tiền trước khi lưu.`;
      }
    }
  }
  return null;
}

export function quoteDeliveryPrice(policy: DeliveryPricePolicy, meters: number | undefined, before: number, after: number): DeliveryPriceRule | null {
  if (!policy.enabled || validateDeliveryPolicy(policy) || meters === undefined || !Number.isSafeInteger(meters) || meters < 0) return null;
  const amount = policy.amountBasis === "before_discount" ? before : after;
  if (!Number.isFinite(amount) || amount < 0) return null;
  return policy.rules.find(r => r.enabled && meters >= r.fromMeters && (r.toMeters === null || meters < r.toMeters)
    && amount >= r.fromAmount && (r.toAmount === null || amount < r.toAmount)) ?? null;
}
