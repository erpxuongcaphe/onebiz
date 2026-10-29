import { act, cleanup, renderHook, waitFor, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/services/supabase/fnb-branch-cost", () => ({ getFnbBranchComponentCosts: mock.read }));
import { useFnbBranchCosts } from "@/lib/hooks/use-fnb-branch-costs";
import { RecipeCostLoadError } from "@/components/shared/recipe-cost-load-error";
const price = (unitCost = 10) => new Map([["milk", { productId: "milk", unitCost, physicalQuantity: 1, costedQuantity: 1 }]]);
beforeEach(() => { mock.read.mockReset(); });
afterEach(cleanup);

it("distinguishes a failed load from a successful empty result and retries", async () => {
  mock.read.mockRejectedValueOnce(new Error("private server detail")).mockResolvedValueOnce(new Map());
  const { result } = renderHook(() => useFnbBranchCosts(true, "branch-a", ["milk"]));
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.costs).toEqual({});
  act(() => result.current.retry());
  expect(result.current.loading).toBe(true); expect(result.current.error).toBe(false);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe(false); expect(mock.read).toHaveBeenCalledTimes(2);
});

it("drops the previous branch immediately and ignores late responses", async () => {
  let resolveA!: (value: ReturnType<typeof price>) => void;
  mock.read.mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve; })).mockResolvedValueOnce(price(20));
  const { result, rerender } = renderHook(({ branch }) => useFnbBranchCosts(true, branch, ["milk"]), { initialProps: { branch: "branch-a" } });
  const signal = mock.read.mock.calls[0][2];
  rerender({ branch: "branch-b" });
  expect(signal.aborted).toBe(true); expect(result.current.costs).toEqual({});
  await waitFor(() => expect(result.current.costs.milk?.unitCost).toBe(20));
  await act(async () => resolveA(price(99)));
  expect(result.current.costs.milk.unitCost).toBe(20);
});

it("does not revive a cached price when returning to a prior branch", async () => {
  mock.read.mockResolvedValueOnce(price()).mockImplementation(() => new Promise(() => {}));
  const { result, rerender } = renderHook(({ branch }) => useFnbBranchCosts(true, branch, ["milk"]), { initialProps: { branch: "a" } });
  await waitFor(() => expect(result.current.costs.milk?.unitCost).toBe(10));
  rerender({ branch: "b" }); rerender({ branch: "a" });
  expect(result.current.costs).toEqual({}); expect(result.current.loading).toBe(true);
});

it("hides prices and aborts on close or permission loss; reopening loads afresh", async () => {
  mock.read.mockResolvedValueOnce(price(0)).mockImplementation(() => new Promise(() => {}));
  const { result, rerender } = renderHook(({ enabled }) => useFnbBranchCosts(enabled, "a", ["milk"]), { initialProps: { enabled: true } });
  await waitFor(() => expect(result.current.costs.milk?.unitCost).toBe(0));
  rerender({ enabled: false });
  expect(result.current.costs).toEqual({}); expect(result.current.loading).toBe(false); expect(result.current.error).toBe(false);
  rerender({ enabled: true });
  expect(result.current.costs).toEqual({}); expect(result.current.loading).toBe(true);
});

it("deduplicates and normalizes the ID set without reloading on reorder", async () => {
  mock.read.mockResolvedValue(price());
  const { result, rerender } = renderHook(({ ids }) => useFnbBranchCosts(true, "a", ids), { initialProps: { ids: ["tea", "milk", "milk"] } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(mock.read.mock.calls[0][1]).toEqual(["milk", "tea"]);
  rerender({ ids: ["milk", "tea"] }); expect(mock.read).toHaveBeenCalledTimes(1);
});

it("does not fetch for unavailable branch, absent permission or an empty list", () => {
  renderHook(() => useFnbBranchCosts(false, "a", ["milk"]));
  renderHook(() => useFnbBranchCosts(true, null, ["milk"]));
  renderHook(() => useFnbBranchCosts(true, "a", []));
  expect(mock.read).not.toHaveBeenCalled();
});

it("offers a concise retry without exposing server details", () => {
  const retry = vi.fn(); render(<RecipeCostLoadError onRetry={retry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Không tải được giá vốn chi nhánh.");
  fireEvent.click(screen.getByRole("button", { name: /Thử lại/ })); expect(retry).toHaveBeenCalledOnce();
});
