import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: mocks.rpc }),
  handleError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
import { recordTimedCash } from "@/lib/services/supabase/cash-timing";
import {
  amendPartyCash,
  CashAmendmentRejectedError,
} from "@/lib/services/supabase/cash-book";
import { settlePartyDocuments } from "@/lib/services/supabase/payments";
import {
  saveFinanceDocument,
  settleFinanceDocument,
} from "@/lib/services/supabase/management-finance";
beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({
    data: { cash_id: "new", documents: [], source: "advance" },
    error: null,
  });
});
describe("money movement write contracts", () => {
  it("posts account, occurrence and performer in one RPC", async () => {
    await recordTimedCash(
      "purchase_order",
      { referenceId: "po", amount: 100, paymentMethod: "transfer" },
      {
        moneyAccountId: "bank",
        performedBy: "payer",
        transactionDate: "2026-09-01",
      },
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_cash_with_account",
      expect.objectContaining({
        p_money_account_id: "bank",
        p_performed_by: "payer",
        p_transaction_date: "2026-09-01",
      }),
    );
  });
  it("retains caller request and expected version for amendments", async () => {
    const row = { id: "cash", updatedAt: "2026-10-16T02:03:04.123456Z" };
    const payload = {
      amount: 100,
      paymentMethod: "cash",
      transactionDate: "2026-09-01",
      occurredAt: null,
      moneyAccountId: null,
      note: "Payment for PO-01",
    };
    await amendPartyCash(row as never, "stable-request", payload, "Fix amount");
    expect(mocks.rpc).toHaveBeenCalledWith("amend_party_cash", {
      p_cash_id: "cash",
      p_expected_updated_at: row.updatedAt,
      p_request_id: "stable-request",
      p_payload: payload,
      p_reason: "Fix amount",
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "CASH_AMEND_ADVANCE_ALREADY_ALLOCATED" },
    });
    await expect(
      amendPartyCash(row as never, "stable-request", payload, "Fix amount"),
    ).rejects.toBeInstanceOf(CashAmendmentRejectedError);
  });
  it("never fans bulk debt settlement into independent payment requests", async () => {
    const payload = {
      mode: "supplier" as const,
      source: "advance" as const,
      branchId: "branch",
      partyId: "supplier",
      lines: [
        { id: "po1", amount: 100 },
        { id: "po2", amount: 50 },
      ],
      note: "Cấn cọc giao hàng đợt 2",
      paymentMethod: "cash",
    };
    await settlePartyDocuments("request", payload);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("settle_party_documents_atomic", {
      p_request_id: "request",
      p_payload: payload,
    });
  });
  it("normalizes legacy transfer UI values and keeps recognition separate from money accounts", async () => {
    await saveFinanceDocument("request", {
      categoryId: "cp",
      businessDate: "2026-09-01",
      amount: 100,
      counterparty: "Supplier",
      allocations: [
        { branchId: "b", recognitionDate: "2026-09-01", amount: 100 },
      ],
      payment: {
        branchId: "b",
        performedBy: "p",
        amount: 100,
        paymentMethod: "bank_transfer",
        moneyAccountId: "bank",
        transactionDate: "2026-09-02",
        occurredAt: "2026-09-02T09:00:00+07:00",
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_management_finance_with_account",
      expect.objectContaining({
        p_payload: expect.objectContaining({
          businessDate: "2026-09-01",
          payment: expect.objectContaining({
            moneyAccountId: "bank",
            paymentMethod: "transfer",
            transactionDate: "2026-09-02",
          }),
        }),
      }),
    );
    await settleFinanceDocument("event", "next", {
      branchId: "b",
      performedBy: "p",
      amount: 100,
      paymentMethod: "bank_transfer",
      transactionDate: "2026-09-02",
      occurredAt: "2026-09-02T09:00:00+07:00",
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "settle_management_finance_event",
      expect.objectContaining({
        p_payload: expect.objectContaining({ paymentMethod: "transfer" }),
      }),
    );
  });
});
