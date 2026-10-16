import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CashAmendmentHistory } from "@/components/shared/cash-amendment-history";

const mocks = vi.hoisted(() => ({ read: vi.fn(), export: vi.fn() }));
vi.mock("@/lib/services/supabase/cash-book", () => ({
  getCashAmendmentHistory: mocks.read,
}));
vi.mock("@/lib/utils/export", () => ({ exportToExcel: mocks.export }));
describe("voucher amendment audit", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.export.mockResolvedValue(undefined);
    mocks.read.mockResolvedValue([
      {
        id: "audit-1",
        createdAt: "2026-10-16T02:00:00Z",
        createdByName: "Admin",
        reason: "Sửa số tiền theo xác nhận NCC",
        originalCode: "PC001",
        replacementCode: "PC002",
        before: {
          amount: 600000,
          note: "Chuyển trả đơn PO001",
          date: "2026-10-15",
          occurredAt: null,
          paymentMethod: "transfer",
          accountName: "VCB quán",
        },
        after: {
          amount: 400000,
          note: "Trả một phần PO001 theo đối soát",
          date: "2026-10-15",
          occurredAt: null,
          paymentMethod: "transfer",
          accountName: "VCB quán",
        },
      },
    ]);
  });
  it("shows exact before/after content and exports both numeric versions", async () => {
    render(<CashAmendmentHistory cashId="cash-1" canExport />);
    expect(
      await screen.findByText("Trả một phần PO001 theo đối soát"),
    ).toBeInTheDocument();
    expect(screen.getByText("Chuyển trả đơn PO001")).toBeInTheDocument();
    expect(screen.getByText("PC001 → PC002")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xuất lịch sử sửa" }));
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          side: "Trước sửa",
          amount: 600000,
          note: "Chuyển trả đơn PO001",
        }),
        expect.objectContaining({
          side: "Sau sửa",
          amount: 400000,
          note: "Trả một phần PO001 theo đối soát",
        }),
      ]),
    );
  });
  it("never claims no changes when the history request failed", async () => {
    mocks.read.mockRejectedValue(new Error("Không đủ quyền xem lịch sử"));
    render(<CashAmendmentHistory cashId="cash-2" canExport={false} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không đủ quyền",
    );
    expect(
      screen.queryByText("Chưa có lần chỉnh sửa."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
