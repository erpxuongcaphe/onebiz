import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentContext: vi.fn(async () => ({
    tenantId: "tenant-a",
    userId: "user-a",
    branchId: "branch-default",
  })),
}));

import {
  findLatestFormDraft,
  hasActiveFormWork,
  useDurableFormDraft,
} from "@/lib/hooks/use-durable-form-draft";
import { useRevalidateOnFocus } from "@/lib/hooks/use-revalidate-on-focus";

describe("durable ERP form drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("isolates and restores a draft by tenant, user, branch and form", async () => {
    const restore = vi.fn();
    const requestOpen = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDurableFormDraft({
        form: "product-edit",
        open: true,
        branchId: "branch-xtb",
        entityId: "product-honey-tea",
        snapshot: { name: "Hồng Trà Mật Ong", sugar: [21, 28, 35] },
        hasContent: (draft) => draft.name.length > 0,
        restore,
        onRequestOpen: requestOpen,
      }),
    );

    await waitFor(() => {
      expect(localStorage.length).toBe(1);
    });
    expect(hasActiveFormWork()).toBe(true);

    const saved = await findLatestFormDraft<{
      name: string;
      sugar: number[];
    }>("product-edit", { branchId: "branch-xtb" });
    expect(saved).toMatchObject({
      entityId: "product-honey-tea",
      data: { name: "Hồng Trà Mật Ong", sugar: [21, 28, 35] },
    });
    expect(
      await findLatestFormDraft("product-edit", { branchId: "branch-other" }),
    ).toBeNull();

    act(() => result.current.clearDraft());
    expect(localStorage.length).toBe(0);
    unmount();
    expect(hasActiveFormWork()).toBe(false);
  });

  it("reopens and restores an existing draft after a full remount", async () => {
    localStorage.setItem(
      "onebiz_form_draft_v1:tenant-a:user-a:branch-xtb:order-create:new",
      JSON.stringify({
        version: 1,
        tenantId: "tenant-a",
        userId: "user-a",
        branchId: "branch-xtb",
        form: "order-create",
        entityId: null,
        updatedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        data: { note: "Giao buổi sáng" },
      }),
    );
    const restore = vi.fn();
    const requestOpen = vi.fn();
    const { rerender } = renderHook(
      ({ open }) =>
        useDurableFormDraft({
          form: "order-create",
          open,
          branchId: "branch-xtb",
          snapshot: { note: "" },
          hasContent: (draft) => draft.note.length > 0,
          restore,
          onRequestOpen: requestOpen,
        }),
      { initialProps: { open: false } },
    );

    await waitFor(() => expect(requestOpen).toHaveBeenCalledTimes(1));
    rerender({ open: true });
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith({ note: "Giao buổi sáng" }),
    );
  });

  it("does not revalidate a list while a form is open", async () => {
    const callback = vi.fn();
    const form = renderHook(() =>
      useDurableFormDraft({
        form: "invoice-create",
        open: true,
        snapshot: { note: "" },
        hasContent: () => false,
        restore: vi.fn(),
      }),
    );
    renderHook(() => useRevalidateOnFocus(callback));

    act(() => window.dispatchEvent(new Event("focus")));
    expect(callback).not.toHaveBeenCalled();
    form.unmount();
  });
});
