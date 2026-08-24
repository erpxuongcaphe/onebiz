import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMeta, setMeta } = vi.hoisted(() => ({
  getMeta: vi.fn(),
  setMeta: vi.fn(),
}));

vi.mock("@/lib/offline/db", () => ({
  getMeta,
  setMeta,
}));

import {
  getFnbTabsStorageKey,
  loadPersistedTabs,
  savePersistedTabs,
} from "@/app/pos/fnb/hooks/persist-tabs";
import type { FnbTabSnapshot } from "@/lib/types/fnb";

const TABS = [
  { id: "tab-a", label: "Mang về #1", items: [] },
] as unknown as FnbTabSnapshot[];

describe("persisted FnB tabs - ban giao quay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dung mot khoa theo chi nhanh, khong tach gio theo nhan vien", () => {
    expect(getFnbTabsStorageKey("branch-xdc")).toBe("fnb-tabs:branch-xdc");
    expect(getFnbTabsStorageKey("branch-xdc")).not.toContain("user");
  });

  it("nguoi tiep nhan tai lai duoc gio dang do cua cung chi nhanh", async () => {
    setMeta.mockResolvedValueOnce(undefined);
    getMeta.mockResolvedValueOnce({
      branchId: "branch-xdc",
      tabs: TABS,
      activeTabId: "tab-a",
      savedAt: Date.now(),
    });

    await savePersistedTabs("branch-xdc", TABS, "tab-a");
    const restored = await loadPersistedTabs("branch-xdc");

    expect(setMeta).toHaveBeenCalledWith(
      "fnb-tabs:branch-xdc",
      expect.objectContaining({ tabs: TABS, activeTabId: "tab-a" }),
    );
    expect(getMeta).toHaveBeenCalledWith("fnb-tabs:branch-xdc");
    expect(restored).toEqual({ tabs: TABS, activeTabId: "tab-a" });
  });
});
