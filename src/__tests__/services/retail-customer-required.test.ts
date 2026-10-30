import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer } from "@/lib/types";
const api = vi.hoisted(() => ({ guest: vi.fn() }));
vi.mock("@/lib/services/supabase/pos-retail-customer-contacts", () => ({ getOrCreateWalkInRetailContact: api.guest }));
import { hasSelectedRetailCustomer, RETAIL_CUSTOMER_REQUIRED_MESSAGE, useRetailCustomerSelection } from "@/app/pos/hooks/use-retail-customer-selection";
import { usePosState } from "@/app/pos/hooks/use-pos-state";
const guest: Customer = { id: "guest-id", code: "KHA-KLE-001", name: "Khách lẻ", phone: "", currentDebt: 0,
  totalSales: 0, totalSalesMinusReturns: 0, type: "individual", createdAt: "2026-10-20", isWalkIn: true };
const buyer = { ...guest, id: "buu-hoa", name: "Bửu Hòa", isWalkIn: false };
beforeEach(() => { api.guest.mockReset(); localStorage.clear(); });
function selection() {
 let currentRequest = 0;
 const onSelected = vi.fn(); const onError = vi.fn();
 const beginRequest = () => ({ requestId: ++currentRequest, tabId: "tab-a" });
 const isCurrent = (token: {requestId: number}) => token.requestId === currentRequest;
 const hook = renderHook(() => useRetailCustomerSelection({ branchId: "warehouse", beginRequest, isCurrent, onSelected, onError }));
 return { hook, onSelected, onError, invalidate: beginRequest };
}
describe("Retail customer must be explicitly selected", () => {
 it("does not treat an empty cart customer or blank legacy ID as Guest", () => {
  expect(hasSelectedRetailCustomer(null)).toBe(false);
  expect(hasSelectedRetailCustomer(undefined)).toBe(false);
  expect(hasSelectedRetailCustomer({ ...guest, id: "  " })).toBe(false);
  expect(hasSelectedRetailCustomer(guest)).toBe(true);
  expect(hasSelectedRetailCustomer(buyer)).toBe(true);
  expect(RETAIL_CUSTOMER_REQUIRED_MESSAGE).toBe("Vui lòng chọn khách hàng trước khi thanh toán.");
 });
 it("asks for selection before checkout reads, shift lookup or payment mutations, with one shared F10/button entry", () => {
  const page = readFileSync("src/app/pos/page.tsx", "utf8");
  const checkout = page.slice(page.indexOf("const handleComplete = useCallback"), page.indexOf("// CEO 04/05/2026: Bỏ handleDebtCheckout"));
  const guard = checkout.indexOf("if (!hasSelectedRetailCustomer(checkoutCustomer))");
  expect(guard).toBeGreaterThan(0);
  expect(guard).toBeLessThan(checkout.indexOf("await getOpenShift"));
  expect(guard).toBeLessThan(checkout.indexOf('setSubmitting("complete")'));
  expect(guard).toBeLessThan(checkout.indexOf("await getCurrentContext"));
  expect(checkout.slice(guard, checkout.indexOf("// State trên màn hình"))).toContain("setCustomerModalOpen(true)");
  expect(checkout.slice(guard, checkout.indexOf("// State trên màn hình"))).toContain("return;");
  expect(checkout).not.toContain("getOrCreateWalkInCustomer");
  expect(checkout).toContain("const resolvedCustomerId = checkoutCustomer.id");
  const f10 = page.slice(page.indexOf('if (e.key === "F10" && !inInput)'),page.indexOf('if (e.key === "Escape")'));
  expect(f10).toContain("handleComplete()");
  expect(page).toContain("onClick={() => handleComplete()}");
  expect(page).toContain(': "Chọn khách hàng")');
 });
 it("never resolves Guest on mount, and applies a named choice without creating Guest", async () => {
  const s = selection();
  expect(api.guest).not.toHaveBeenCalled();
  await act(async () => { await s.hook.result.current(buyer); });
  expect(s.onSelected).toHaveBeenLastCalledWith(buyer);
  expect(api.guest).not.toHaveBeenCalled(); s.hook.unmount();
 });
 it("resolves Guest only after the cashier explicitly chooses it and clears the prior customer while loading", async () => {
  let resolve!: (customer: Customer) => void;
  api.guest.mockReturnValue(new Promise<Customer>(done => { resolve = done; }));
  const s = selection(); let pending!: Promise<void>;
  act(() => { pending = s.hook.result.current(null); });
  expect(api.guest).toHaveBeenCalledTimes(1);
  expect(s.onSelected).toHaveBeenCalledExactlyOnceWith(null);
  await act(async () => { resolve(guest); await pending; });
  expect(s.onSelected).toHaveBeenLastCalledWith(guest); s.hook.unmount();
 });
 it("does not replace another customer selected while Guest was loading", async () => {
  let resolve!: (customer: Customer) => void;
  api.guest.mockReturnValue(new Promise<Customer>(done => { resolve = done; }));
  const s = selection(); let pending!: Promise<void>;
  act(() => { pending = s.hook.result.current(null); });
  await act(async () => { await s.hook.result.current(buyer); resolve(guest); await pending; });
  expect(s.onSelected).toHaveBeenLastCalledWith(buyer);
  expect(s.onSelected).not.toHaveBeenCalledWith(guest); s.hook.unmount();
 });
 it("discards a late Guest result after changing invoice tab, branch or selling mode", async () => {
  let resolve!: (customer: Customer) => void;
  api.guest.mockReturnValue(new Promise<Customer>(done => { resolve = done; }));
  const s = selection(); let pending!: Promise<void>;
  act(() => { pending = s.hook.result.current(null); });
  s.invalidate();
  await act(async () => { resolve(guest); await pending; });
  expect(s.onSelected).toHaveBeenCalledExactlyOnceWith(null); s.hook.unmount();
 });
 it("keeps selection empty and surfaces failure instead of silently checking out", async () => {
  const error = new Error("Cannot resolve Guest"); api.guest.mockRejectedValue(error);
  const s = selection();
  await act(async () => { await s.hook.result.current(null); });
  expect(s.onSelected).toHaveBeenCalledExactlyOnceWith(null);
  expect(s.onError).toHaveBeenCalledWith(error); s.hook.unmount();
 });
 it("retains the selected customer through F5 snapshots and requires a new choice after clearing", () => {
  const state = renderHook(() => usePosState());
  act(() => state.result.current.setCustomer(guest, "user-pick"));
  const saved = state.result.current.getSnapshot();
  act(() => state.result.current.clearCart());
  expect(hasSelectedRetailCustomer(state.result.current.customer)).toBe(false);
  act(() => state.result.current.restoreSnapshot(saved));
  expect(state.result.current.customer?.id).toBe(guest.id);
  expect(hasSelectedRetailCustomer(state.result.current.customer)).toBe(true);
  state.unmount();
 });
});
