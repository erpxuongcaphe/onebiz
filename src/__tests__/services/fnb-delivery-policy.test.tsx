import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { quoteDeliveryPrice, validateDeliveryPolicy, type DeliveryPricePolicy, type DeliveryPriceRule } from "@/lib/fnb-delivery-policy";
import { DeliveryPolicyEditor } from "@/app/(main)/cai-dat/phi-giao-hang/delivery-policy-editor";
import { FnbDeliveryPrice } from "@/app/pos/fnb/components/fnb-delivery-price";

afterEach(cleanup);
const rule = (id: string, fromMeters: number, toMeters: number | null, fromAmount: number, toAmount: number | null, fee: number): DeliveryPriceRule => ({ id, name: id, fromMeters, toMeters, fromAmount, toAmount, fee, enabled: true });
const policy: DeliveryPricePolicy = { revision: 1, enabled: true, amountBasis: "after_discount", rules: [
  rule("Dưới 500 m", 0, 500, 0, null, 0),
  rule("500 m–1 km, dưới 50k", 500, 1000, 0, 50000, 5000),
  rule("500 m–1 km, từ 50k", 500, 1000, 50000, null, 0),
  rule("1–3 km, dưới 50k", 1000, 3000, 0, 50000, 10000),
  rule("1–3 km, từ 50k", 1000, 3000, 50000, null, 0),
  rule("3–5 km, từ 100k", 3000, 5001, 100000, 150000, 15000),
  rule("3–5 km, từ 150k", 3000, 5001, 150000, null, 0),
] };

describe("delivery price boundaries and editable policies", () => {
  it.each([
    [499, 0, 0], [500, 49999, 5000], [500, 50000, 0], [999, 50000, 0],
    [1000, 49999, 10000], [1000, 50000, 0], [2999, 50000, 0],
    [3000, 100000, 15000], [3000, 149999, 15000], [3000, 150000, 0], [5000, 150000, 0],
  ])("quotes %im / %iđ without overlapping rules", (meters, amount, fee) => {
    expect(validateDeliveryPolicy(policy)).toBeNull();
    expect(quoteDeliveryPrice(policy, meters, amount, amount)?.fee).toBe(fee);
  });
  it("never treats a missing range, disabled policy or missing distance as free delivery", () => {
    expect(quoteDeliveryPrice(policy, 3000, 99999, 99999)).toBeNull();
    expect(quoteDeliveryPrice(policy, 5001, 200000, 200000)).toBeNull();
    expect(quoteDeliveryPrice(policy, undefined, 200000, 200000)).toBeNull();
    expect(quoteDeliveryPrice({ ...policy, enabled: false }, 100, 200000, 200000)).toBeNull();
  });
  it("supports before/after discount basis and recalculates when the bill crosses a threshold", () => {
    expect(quoteDeliveryPrice(policy, 1000, 60000, 45000)?.fee).toBe(10000);
    expect(quoteDeliveryPrice({ ...policy, amountBasis: "before_discount" }, 1000, 60000, 45000)?.fee).toBe(0);
    expect(quoteDeliveryPrice(policy, 1000, 60000, 50000)?.fee).toBe(0);
  });
  it("rejects ambiguous overlaps and invalid data, permits adjoining ranges and disabled drafts", () => {
    expect(validateDeliveryPolicy({ ...policy, rules: [...policy.rules, rule("Trùng", 500, 3000, 0, null, 0)] })).toMatch(/trùng điều kiện/);
    expect(validateDeliveryPolicy({ ...policy, rules: [rule("Sai", 0, 0, 0, null, 1000)] })).toBeTruthy();
    expect(validateDeliveryPolicy({ ...policy, rules: [{ ...policy.rules[0], fee: NaN }] })).toBeTruthy();
    expect(validateDeliveryPolicy({ ...policy, enabled: false, rules: [] })).toBeNull();
  });
  it("changes settings locally and saves only after the explicit save button", () => {
    const change = vi.fn(), save = vi.fn();
    render(<DeliveryPolicyEditor policy={policy} onChange={change} onSave={save} />);
    fireEvent.change(screen.getByLabelText("Cơ sở tính giá trị bill"), { target: { value: "before_discount" } });
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ amountBasis: "before_discount" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Lưu chính sách giao hàng" }));
    expect(save).toHaveBeenCalledOnce();
  });
  it("shows the quoted amount at POS, accepts decimal comma and reports an uncovered range", () => {
    const change = vi.fn();
    const { rerender } = render(<FnbDeliveryPrice policy={policy} meters={1000} before={60000} after={45000} onChange={change} />);
    expect(screen.getByRole("status")).toHaveTextContent(/10[.,]000/);
    fireEvent.change(screen.getByLabelText("Khoảng cách giao (km)"), { target: { value: "1,5" } });
    expect(change).toHaveBeenCalledWith(1500);
    rerender(<FnbDeliveryPrice policy={policy} meters={4000} before={50000} after={50000} onChange={change} />);
    expect(screen.getByRole("status")).toHaveTextContent("Chưa có mức phí phù hợp");
  });
});
