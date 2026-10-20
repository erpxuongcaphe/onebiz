import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ ledger: vi.fn(), changed: vi.fn(), history: vi.fn(), close: vi.fn(), child: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "tenant" }, user: { id: "user" } }) }));
vi.mock("@/lib/services/supabase/cash-book", () => ({ getPartyAdvanceLedger: mocks.ledger }));
vi.mock("@/components/shared/dialogs/refund-advance-dialog", () => ({ RefundAdvanceDialog: (props: { source: { cashCode: string }; onSuccess: (message: string) => void }) => {
  mocks.child(props); return <button onClick={() => props.onSuccess("Đã ghi phiếu thu PT-1")}>Xác nhận phiếu thu {props.source.cashCode}</button>;
} }));
import { SupplierAdvanceRefundDialog } from "@/components/shared/dialogs/supplier-advance-refund-dialog";
const rows = [
 { id: "a", branchId: "branch", branchName: "Kho Tổng", cashCode: "PC-A", date: "2026-10-01", note: "Ứng lô hàng", originalAmount: 1000, appliedAmount: 300, refundedAmount: 0, remainingAmount: 700, status: "active", allocations: [{documentCode: "PO-1", amount: 300, note: "Cấn", createdAt: "2026-10-02"}] },
 { id: "b", branchId: "branch", branchName: "Kho Tổng", cashCode: "PC-B", date: "2026-10-03", note: "Ứng lô khác", originalAmount: 500, appliedAmount: 0, refundedAmount: 0, remainingAmount: 500, status: "active", allocations: [] },
 { id: "cancelled", branchId: "branch", branchName: "Kho Tổng", cashCode: "PC-CANCEL", date: "2026-10-01", note: "Đã hủy", originalAmount: 999, remainingAmount: 0, status: "cancelled", allocations: [] },
];
const props = { partyId: "supplier", partyName: "Trung Kiên", branchId: "branch", onClose: mocks.close, onChanged: mocks.changed, onHistory: mocks.history };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.ledger.mockResolvedValue(rows); });
afterEach(cleanup);
describe("supplier refund source workflow", () => {
 it("loads the exact supplier and branch, preserves PO allocations and forwards only the chosen source", async () => {
  render(<SupplierAdvanceRefundDialog {...props}/>);
  fireEvent.click(await screen.findByRole("button", {name: "Nhận hoàn từ PC-B"}));
  expect(mocks.ledger).toHaveBeenCalledWith("supplier", "supplier", "branch");
  expect(mocks.child.mock.calls.at(-1)?.[0]).toMatchObject({mode: "supplier", partyId: "supplier", source: rows[1]});
  expect(screen.queryByRole("button", {name: /PC-CANCEL/})).not.toBeInTheDocument();
  expect(screen.getByText(/PO-1/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Xác nhận phiếu thu PC-B"}));
  await waitFor(() => expect(mocks.changed).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Đã ghi phiếu thu PT-1")).toBeInTheDocument();
  await waitFor(() => expect(mocks.ledger).toHaveBeenCalledTimes(2));
 });
 it("fails closed on a ledger error and supports explicit reload", async () => {
  mocks.ledger.mockRejectedValueOnce(new Error("Nguồn chưa xác minh"));
  render(<SupplierAdvanceRefundDialog {...props}/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Nguồn chưa xác minh");
  expect(screen.queryByRole("button", {name: /Nhận hoàn từ/})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Tải lại nguồn ứng"}));
  expect(await screen.findByRole("button", {name: "Nhận hoàn từ PC-A"})).toBeInTheDocument();
 });
 it("offers recovery after a full refund with a lost response even when the source is exhausted", async () => {
  mocks.ledger.mockResolvedValue([{...rows[0], status: "exhausted", remainingAmount: 0}]);
  localStorage.setItem("onebiz_advance_refund_v1:tenant:user:supplier:a", JSON.stringify({id: "pending"}));
  render(<SupplierAdvanceRefundDialog {...props}/>);
  fireEvent.click(await screen.findByRole("button", {name: "Kiểm tra hoàn đang chờ"}));
  expect(mocks.child.mock.calls.at(-1)?.[0].source.remainingAmount).toBe(0);
 });
 it("does not invent a refundable balance and keeps history reachable when nothing remains", async () => {
  mocks.ledger.mockResolvedValue([]);
  render(<SupplierAdvanceRefundDialog {...props}/>);
  expect(await screen.findByText(/Không còn khoản ứng khả dụng/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Xem lịch sử thu chi & phân bổ"}));
  expect(mocks.history).toHaveBeenCalledOnce();
 });
});
