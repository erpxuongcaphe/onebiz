import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadPersistedTabs, savePersistedTabs, clearPersistedTabs } = vi.hoisted(
  () => ({
    loadPersistedTabs: vi.fn(),
    savePersistedTabs: vi.fn(),
    clearPersistedTabs: vi.fn(),
  }),
);

vi.mock("@/app/pos/fnb/hooks/persist-tabs", () => ({
  loadPersistedTabs,
  savePersistedTabs,
  clearPersistedTabs,
}));

import { useFnbPosState } from "@/app/pos/fnb/hooks/use-fnb-pos-state";

const branchId = "branch-xdc";

function makeLine() {
  return {
    productId: "americano",
    productName: "Americano",
    quantity: 1,
    unitPrice: 35_000,
    toppings: [],
  };
}

describe("bàn giao PIN F&B giữ giỏ theo chi nhánh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadPersistedTabs.mockResolvedValue(null);
    savePersistedTabs.mockResolvedValue(undefined);
    clearPersistedTabs.mockResolvedValue(undefined);
  });

  it("lưu ngay món vừa chọn trước khi POS tải lại sau đổi PIN", async () => {
    const { result, unmount } = renderHook(() => useFnbPosState(branchId));

    await waitFor(() => {
      expect(loadPersistedTabs).toHaveBeenCalledWith(branchId);
    });

    act(() => {
      result.current.addLine(makeLine());
    });

    await act(async () => {
      await result.current.flushPersistedTabs();
    });

    expect(savePersistedTabs).toHaveBeenLastCalledWith(
      branchId,
      [
        expect.objectContaining({
          customerName: "Khách lẻ",
          lines: [expect.objectContaining({ productId: "americano", quantity: 1 })],
        }),
      ],
      result.current.activeTabId,
    );
    expect(clearPersistedTabs).not.toHaveBeenCalled();
    unmount();
  });

  it("không để lại bản ghi giỏ rỗng khi bàn giao PIN", async () => {
    const { result, unmount } = renderHook(() => useFnbPosState(branchId));

    await waitFor(() => {
      expect(loadPersistedTabs).toHaveBeenCalledWith(branchId);
    });

    await act(async () => {
      await result.current.flushPersistedTabs();
    });

    expect(clearPersistedTabs).toHaveBeenCalledWith(branchId);
    expect(savePersistedTabs).not.toHaveBeenCalled();
    unmount();
  });

  it("khôi phục đúng giỏ của chi nhánh, không gắn với nhân viên cũ", async () => {
    loadPersistedTabs.mockResolvedValueOnce({
      tabs: [
        {
          id: "tab-handover",
          label: "Mang về #1",
          orderType: "takeaway",
          customerName: "Khách lẻ",
          lines: [
            {
              id: "line-handover",
              productId: "americano",
              productName: "Americano",
              quantity: 2,
              unitPrice: 35_000,
              toppings: [],
              lineTotal: 70_000,
            },
          ],
        },
      ],
      activeTabId: "tab-handover",
    });

    const { result, unmount } = renderHook(() => useFnbPosState(branchId));

    await waitFor(() => {
      expect(result.current.activeTabId).toBe("tab-handover");
    });

    expect(result.current.activeTab?.lines).toEqual([
      expect.objectContaining({ productId: "americano", quantity: 2 }),
    ]);
    unmount();
  });
});
