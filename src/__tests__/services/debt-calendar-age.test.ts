import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ from: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: state.from }), getCurrentContext: async () => ({ tenantId: "t" }),
  handleError: (error: Error) => { throw error; },
}));
vi.mock("@/lib/services/supabase/read-history-pages", () => ({ readHistoryPages: state.read }));
import { getOpenInvoicesByCustomer, getOpenPurchasesBySupplier } from "@/lib/services/supabase/payments";

describe("open debt reader calendar display", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T02:00:00Z"));
    const query = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), in: vi.fn(), order: vi.fn() };
    for (const method of Object.values(query)) method.mockReturnValue(query);
    state.from.mockReturnValue(query);
    state.read.mockResolvedValue([{ id: "doc", code: "DOC-01", ngay_chung_tu: "2026-10-12T09:00:00Z", created_at: "2026-10-12T09:00:00Z", total: 630000, paid: 0, debt: 630000 }]);
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
  it.each([getOpenInvoicesByCustomer, getOpenPurchasesBySupplier])("changes display age only, preserving the source date and money", async read => {
    expect(await read("party", "branch")).toEqual([{ id: "doc", code: "DOC-01", date: "2026-10-12T09:00:00Z", total: 630000, paid: 0, debt: 630000, ageDays: 7 }]);
  });
});
