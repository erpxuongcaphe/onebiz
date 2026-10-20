import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { quoteDeliveryPrice, validateDeliveryPolicy, getDeliveryDistancePresets, formatDeliveryDistanceRange, resolveDeliveryDistanceMeters, type DeliveryDistanceRange, type DeliveryPricePolicy, type DeliveryPriceRule } from "@/lib/fnb-delivery-policy";
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


const liveBoundaries: DeliveryPricePolicy = { ...policy, rules: policy.rules.map(r => ({ ...r,
  fromMeters: r.fromMeters === 3000 ? 3001 : r.fromMeters,
  toMeters: r.toMeters === 3000 ? 3001 : r.toMeters,
})) };
function DistanceHarness({ after = 75000 }: { after?: number }) {
  const [distance, setDistance] = useState<{ meters?: number; range?: DeliveryDistanceRange }>({});
  return <FnbDeliveryPrice policy={liveBoundaries} {...distance} before={150000} after={after}
    onChange={(meters, range) => setDistance({ meters, range })} />;
}

describe("quick delivery distance choices", () => {
  it("deduplicates amount brackets and labels exact 3 km / 5 km boundaries truthfully", () => {
    expect(getDeliveryDistancePresets(liveBoundaries).map(formatDeliveryDistanceRange)).toEqual([
      "Dưới 500 m", "500 m – dưới 1 km", "1 km – 3 km", "Trên 3 km – 5 km",
    ]);
    expect(quoteDeliveryPrice(liveBoundaries, 3000, 50000, 50000)?.fee).toBe(0);
    expect(quoteDeliveryPrice(liveBoundaries, 3001, 50000, 50000)).toBeNull();
  });
  it("partitions overlapping distance rules so one preset never crosses a price boundary", () => {
    const customPolicy: DeliveryPricePolicy = { ...policy, rules: [
      rule("small", 0, 1000, 0, 50000, 5000),
      rule("large", 0, 3000, 50000, null, 0),
      rule("far", 4000, null, 0, null, 20000),
      { ...rule("off", 200, 300, 0, null, 0), enabled: false },
    ] };
    expect(getDeliveryDistancePresets(customPolicy)).toEqual([
      { fromMeters: 0, toMeters: 1000 }, { fromMeters: 1000, toMeters: 3000 }, { fromMeters: 4000, toMeters: null },
    ]);
    expect(formatDeliveryDistanceRange({ fromMeters: 4000, toMeters: null })).toBe("Từ 4 km");
    expect(getDeliveryDistancePresets({ ...customPolicy, enabled: false })).toEqual([]);
  });
  it("quotes in one click and re-quotes after discount without asking for distance again", () => {
    const { rerender } = render(<DistanceHarness />);
    expect(screen.queryByLabelText("Khoảng cách giao (km)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1 km – 3 km" }));
    expect(screen.getByRole("button", { name: "1 km – 3 km" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Miễn phí giao hàng");
    rerender(<DistanceHarness after={45000} />);
    expect(screen.getByRole("status")).toHaveTextContent(/10[.,]000/);
    expect(screen.getByRole("button", { name: "1 km – 3 km" })).toHaveAttribute("aria-pressed", "true");
  });
  it("does not turn an ineligible far order into free delivery", () => {
    const { rerender } = render(<DistanceHarness after={99999} />);
    fireEvent.click(screen.getByRole("button", { name: "Trên 3 km – 5 km" }));
    expect(screen.getByRole("status")).toHaveTextContent("Chưa có mức phí phù hợp");
    rerender(<DistanceHarness after={100000} />);
    expect(screen.getByRole("status")).toHaveTextContent(/15[.,]000/);
    rerender(<DistanceHarness after={150000} />);
    expect(screen.getByRole("status")).toHaveTextContent("Miễn phí giao hàng");
  });
  it("clears the range when switching to custom entry and accepts decimal comma", () => {
    render(<DistanceHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Dưới 500 m" }));
    fireEvent.click(screen.getByRole("button", { name: "Tự nhập khoảng cách" }));
    expect(screen.getByRole("status")).toHaveTextContent("Chọn khoảng cách");
    fireEvent.change(screen.getByLabelText("Khoảng cách giao (km)"), { target: { value: "3," } });
    expect(screen.getByLabelText("Khoảng cách giao (km)")).toHaveValue("3,");
    fireEvent.change(screen.getByLabelText("Khoảng cách giao (km)"), { target: { value: "3,5" } });
    expect(screen.getByRole("status")).toHaveTextContent("Chưa có mức phí phù hợp");
    fireEvent.click(screen.getByRole("button", { name: "Dưới 500 m" }));
    fireEvent.click(screen.getByRole("button", { name: "Tự nhập khoảng cách" }));
    expect(screen.getByLabelText("Khoảng cách giao (km)")).toHaveValue("3,5");
  });
  it("restores a saved range and blocks stale boundaries after a configuration change", () => {
    const range = { fromMeters: 1000, toMeters: 3001 };
    const { rerender } = render(<FnbDeliveryPrice policy={liveBoundaries} meters={1000} range={range} before={75000} after={75000} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "1 km – 3 km" })).toHaveAttribute("aria-pressed", "true");
    rerender(<FnbDeliveryPrice policy={policy} meters={1000} range={range} before={75000} after={75000} onChange={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Chọn lại khoảng cách");
    expect(resolveDeliveryDistanceMeters(policy, 1000, range)).toBeUndefined();
    expect(resolveDeliveryDistanceMeters(liveBoundaries, 1000, range)).toBe(1000);
    expect(resolveDeliveryDistanceMeters(liveBoundaries, 1500, range)).toBeUndefined();
    expect(resolveDeliveryDistanceMeters(policy, 1500)).toBe(1500);
  });
  it("keeps external restored manual distances visible and rejects unsafe input", () => {
    const change = vi.fn();
    const { rerender } = render(<FnbDeliveryPrice policy={policy} meters={1500} before={75000} after={75000} onChange={change} />);
    rerender(<FnbDeliveryPrice policy={policy} meters={2500} before={75000} after={75000} onChange={change} />);
    expect(screen.getByLabelText("Khoảng cách giao (km)")).toHaveValue("2.5");
    fireEvent.change(screen.getByLabelText("Khoảng cách giao (km)"), { target: { value: "9999999999999999999999" } });
    expect(change).toHaveBeenLastCalledWith(undefined);
  });
});
