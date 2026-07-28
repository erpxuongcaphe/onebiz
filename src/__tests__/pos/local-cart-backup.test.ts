/**
 * Backup giỏ POS trong localStorage — chốt hành vi 28/07:
 * backup phải GIỮ KHÁCH kể cả khi giỏ trống (gốc vụ "khách tự nhảy về
 * Khách lẻ" khi tablet idle reload).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  saveLocalCart,
  loadLocalCart,
  clearLocalCart,
} from "@/app/pos/hooks/use-auto-save-draft";

const TENANT = "t-test";
const BRANCH = "b-test";

const KHACH = { id: "kh-1", name: "Chị Hà - Tân Vạn" };

function lineMau() {
  return {
    productId: "p1",
    productName: "Cà phê",
    unit: "Gói",
    quantity: 1,
    unitPrice: 100000,
    discount: { mode: "amount" as const, value: 0 },
  };
}

const base = {
  orderDiscount: { mode: "amount" as const, value: 0 },
  paymentMethod: "cash" as const,
  sessionId: "sess-1",
};

describe("backup giỏ POS (localStorage)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("giỏ có hàng + khách → đọc lại đủ cả hai", () => {
    saveLocalCart(TENANT, BRANCH, {
      ...base,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lines: [lineMau() as any],
      customer: KHACH,
    });
    const out = loadLocalCart(TENANT, BRANCH);
    expect(out?.lines).toHaveLength(1);
    expect(out?.customer?.id).toBe("kh-1");
  });

  it("GIỎ TRỐNG nhưng ĐÃ CHỌN KHÁCH → vẫn phải giữ khách (fix 28/07)", () => {
    saveLocalCart(TENANT, BRANCH, { ...base, lines: [], customer: KHACH });
    const out = loadLocalCart(TENANT, BRANCH);
    expect(out).not.toBeNull();
    expect(out?.customer?.name).toBe("Chị Hà - Tân Vạn");
    expect(out?.lines).toHaveLength(0);
  });

  it("giỏ trống + không khách → coi như không có backup", () => {
    saveLocalCart(TENANT, BRANCH, { ...base, lines: [], customer: null });
    expect(loadLocalCart(TENANT, BRANCH)).toBeNull();
  });

  it("clearLocalCart xoá sạch", () => {
    saveLocalCart(TENANT, BRANCH, { ...base, lines: [], customer: KHACH });
    clearLocalCart(TENANT, BRANCH);
    expect(loadLocalCart(TENANT, BRANCH)).toBeNull();
  });

  it("backup quá 7 ngày → bỏ", () => {
    saveLocalCart(TENANT, BRANCH, { ...base, lines: [], customer: KHACH });
    const key = Object.keys(localStorage).find((k) =>
      k.includes("pos:retail:cart"),
    )!;
    const parsed = JSON.parse(localStorage.getItem(key)!);
    parsed.savedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(key, JSON.stringify(parsed));
    expect(loadLocalCart(TENANT, BRANCH)).toBeNull();
  });
});
