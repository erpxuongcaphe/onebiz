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
import type { FnbTabSnapshot } from "@/lib/types/fnb";

const branchId = "branch-xdc";

type PersistedTabs = {
  tabs: FnbTabSnapshot[];
  activeTabId: string;
};

function createDeferredRestore() {
  let resolve!: (value: PersistedTabs) => void;
  const promise = new Promise<PersistedTabs>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

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

  it("không để snapshot tải chậm ghi đè đơn nhân viên vừa tạo", async () => {
    const deferredRestore = createDeferredRestore();
    loadPersistedTabs.mockReturnValueOnce(deferredRestore.promise);

    const { result, unmount } = renderHook(() => useFnbPosState(branchId));

    await waitFor(() => {
      expect(loadPersistedTabs).toHaveBeenCalledWith(branchId);
    });

    let newTabId = "";
    act(() => {
      newTabId = result.current.createTab("Mang về #2", "takeaway");
    });

    await act(async () => {
      deferredRestore.resolve({
        tabs: [
          {
            id: "tab-cu",
            label: "Đơn cũ",
            orderType: "takeaway",
            customerName: "Khách lẻ",
            lines: [],
          },
        ],
        activeTabId: "tab-cu",
      });
      await Promise.resolve();
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTabId).toBe(newTabId);
    expect(result.current.tabs.map((tab) => tab.id)).not.toContain("tab-cu");
    unmount();
  });

  it("bỏ lượt khôi phục của chi nhánh cũ sau khi đã chuyển quán", async () => {
    const oldBranchRestore = createDeferredRestore();
    const newBranchRestore = createDeferredRestore();
    loadPersistedTabs
      .mockReturnValueOnce(oldBranchRestore.promise)
      .mockReturnValueOnce(newBranchRestore.promise);

    const { result, rerender, unmount } = renderHook(
      ({ currentBranchId }) => useFnbPosState(currentBranchId),
      { initialProps: { currentBranchId: "branch-cu" } },
    );

    await waitFor(() => {
      expect(loadPersistedTabs).toHaveBeenCalledWith("branch-cu");
    });

    rerender({ currentBranchId: "branch-moi" });
    await waitFor(() => {
      expect(loadPersistedTabs).toHaveBeenCalledWith("branch-moi");
    });

    await act(async () => {
      newBranchRestore.resolve({
        tabs: [
          {
            id: "tab-moi",
            label: "Giỏ quán mới",
            orderType: "takeaway",
            customerName: "Khách lẻ",
            lines: [],
          },
        ],
        activeTabId: "tab-moi",
      });
      await Promise.resolve();
    });

    await act(async () => {
      oldBranchRestore.resolve({
        tabs: [
          {
            id: "tab-cu",
            label: "Giỏ quán cũ",
            orderType: "takeaway",
            customerName: "Khách lẻ",
            lines: [],
          },
        ],
        activeTabId: "tab-cu",
      });
      await Promise.resolve();
    });

    expect(result.current.activeTabId).toBe("tab-moi");
    expect(result.current.tabs.map((tab) => tab.id)).not.toContain("tab-cu");
    unmount();
  });
});
