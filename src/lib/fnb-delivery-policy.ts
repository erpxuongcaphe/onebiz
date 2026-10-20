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

/** A quick choice is a distance interval, never a measured address distance. */
export interface DeliveryDistanceRange {
  fromMeters: number;
  toMeters: number | null;
}

export function formatDeliveryDistanceRange(range: DeliveryDistanceRange): string {
  const format = (m: number) => m < 1000 ? `${m} m` : `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(m / 1000)} km`;
  const lowerInclusiveKm = range.fromMeters > 1000 && range.fromMeters % 1000 === 1;
  const upperInclusiveKm = range.toMeters !== null && range.toMeters > 1000 && range.toMeters % 1000 === 1;
  const lower = format(lowerInclusiveKm ? range.fromMeters - 1 : range.fromMeters);
  if (range.toMeters === null) return `${lowerInclusiveKm ? "Trên" : "Từ"} ${lower}`;
  if (range.fromMeters === 0) return `${upperInclusiveKm ? "Đến" : "Dưới"} ${format(upperInclusiveKm ? range.toMeters - 1 : range.toMeters)}`;
  return `${lowerInclusiveKm ? "Trên " : ""}${lower} – ${upperInclusiveKm ? "" : "dưới "}${format(upperInclusiveKm ? range.toMeters - 1 : range.toMeters)}`;
}

/** Partition every active distance boundary: price cannot change inside a choice,
 * even when different amount brackets use overlapping distance intervals. */
export function getDeliveryDistancePresets(policy: DeliveryPricePolicy): DeliveryDistanceRange[] {
  if (!policy.enabled || validateDeliveryPolicy(policy)) return [];
  const active = policy.rules.filter(rule => rule.enabled);
  const boundaries = [...new Set(active.flatMap(rule => rule.toMeters === null ? [rule.fromMeters] : [rule.fromMeters, rule.toMeters]))].sort((a, b) => a - b);
  return boundaries.flatMap((fromMeters, i) => {
    if (!active.some(rule => fromMeters >= rule.fromMeters && (rule.toMeters === null || fromMeters < rule.toMeters))) return [];
    return [{ fromMeters, toMeters: boundaries[i + 1] ?? null }];
  });
}

/** Invalidate an old range when the branch policy changes its boundaries. */
export function resolveDeliveryDistanceMeters(policy: DeliveryPricePolicy, meters?: number, range?: DeliveryDistanceRange): number | undefined {
  if (!range) return meters;
  return meters === range.fromMeters && getDeliveryDistancePresets(policy).some(p => p.fromMeters === range.fromMeters && p.toMeters === range.toMeters) ? meters : undefined;
}
