import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom, rpc: mockRpc }),
  getPaginationRange: (p: { page: number; pageSize: number }) => ({
    from: p.page * p.pageSize,
    to: p.page * p.pageSize + p.pageSize - 1,
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error("[" + ctx + "] " + error.message);
  },
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test-1"),
}));

import { cancelInvoice } from "@/lib/services/supabase/invoices";

describe("cancelInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({
      data: { invoice_id: "inv-1", status: "cancelled" },
      error: null,
    });
  });

  it("cancels draft or confirmed invoices in one server transaction", async () => {
    await cancelInvoice("inv-1");

    expect(mockRpc).toHaveBeenCalledWith("cancel_draft_invoice_atomic", {
      p_invoice_id: "inv-1",
      p_reason: "Hủy từ giao diện hóa đơn",
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it.each(["completed", "cancelled"])(
    "keeps terminal invoice status %s protected by the server",
    async (status) => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "Không thể hủy hóa đơn ở trạng thái " + status },
      });

      await expect(cancelInvoice("inv-terminal")).rejects.toThrow("Không thể hủy");
      expect(mockFrom).not.toHaveBeenCalled();
    },
  );

  it("does not fall back to direct writes when the RPC fails", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "INVOICE_CANCEL_CONFLICT" },
    });

    await expect(cancelInvoice("inv-2")).rejects.toThrow(
      "INVOICE_CANCEL_CONFLICT",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
