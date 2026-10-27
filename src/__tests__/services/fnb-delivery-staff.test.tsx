import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/services/supabase/fnb-delivery-staff", () => ({ listFnbDeliveryStaff: mock.load }));
import { useDeliveryStaff } from "@/app/pos/fnb/hooks/use-delivery-staff";
beforeEach(() => mock.load.mockReset());
describe("delivery roster branch and session isolation", () => {
  it("hides old rows immediately and ignores late replies from another branch", async () => {
    let finishA!: (rows: { id: string; name: string }[]) => void;
    mock.load.mockImplementation((branch: string) => branch === "a" ? new Promise(resolve => { finishA = resolve; }) : Promise.resolve([{ id: "b1", name: "B" }]));
    const { result, rerender } = renderHook(({ branch }) => useDeliveryStaff(branch,"actor"), { initialProps: { branch: "a" } });
    rerender({ branch: "b" });
    expect(result.current.options).toEqual([]);
    await waitFor(() => expect(result.current.options[0]?.id).toBe("b1"));
    await act(async () => finishA([{ id: "a1", name: "A" }]));
    expect(result.current.options[0]?.id).toBe("b1");
    rerender({ branch: "" });
    expect(result.current.options).toEqual([]);
  });
  it("does not reuse another employee session's roster and can retry a failed read", async () => {
    mock.load.mockResolvedValueOnce([{ id: "one", name: "One" }]).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce([{ id: "two", name: "Two" }]);
    const { result, rerender } = renderHook(({ actor }) => useDeliveryStaff("branch",actor), { initialProps: { actor: "first" } });
    await waitFor(() => expect(result.current.options).toHaveLength(1));
    rerender({ actor: "second" });
    expect(result.current.options).toEqual([]);
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.options).toEqual([]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.options[0]?.id).toBe("two"));
    expect(result.current.error).toBe(false);
  });
});
