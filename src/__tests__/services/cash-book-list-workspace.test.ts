import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getPaginationRange: () => ({ from: 0, to: 14 }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-1"),
  getCurrentContext: vi.fn(),
  handleError: (error: { message?: string }, context: string) => {
    throw new Error(`[${context}] ${error.message ?? "unknown"}`);
  },
}));

const { getCashBookListWorkspace, getAllCashBookEntries } =
  await import("@/lib/services/supabase/cash-book");

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: {
      items: [
        {
          id: "cash-1",
          code: "PT000001",
          transaction_date: "2026-08-10",
          created_at: "2026-08-10T08:00:00Z",
          type: "receipt",
          category: "customer_payment",
          counterparty: "Khách A",
          amount: "125000",
          payment_method: "transfer",
          status: "completed",
          created_by: "user-1",
          profiles: { full_name: "Nhân viên A" },
          branches: { name: "Chi nhánh A" },
        },
      ],
      total: 1,
      summary: {
        totalReceipt: "125000",
        totalPayment: "0",
        receiptCount: 1,
        paymentCount: 0,
        openingBalance: "500000",
        closingBalance: "625000",
      },
      categoryOptions: [{ value: "customer_payment", count: 3 }],
    },
    error: null,
  });
});

describe("getCashBookListWorkspace", () => {
  it("maps accounting date, branch, creator and full-result metrics", async () => {
    const result = await getCashBookListWorkspace({ page: 0, pageSize: 15 });

    expect(result.data[0]).toMatchObject({
      date: "2026-08-10",
      createdAt: "2026-08-10T08:00:00Z",
      branchName: "Chi nhánh A",
      createdByName: "Nhân viên A",
      paymentMethod: "transfer",
      status: "completed",
    });
    expect(result.summary).toEqual({
      totalReceipt: 125000,
      totalPayment: 0,
      receiptCount: 1,
      paymentCount: 0,
      openingBalance: 500000,
      closingBalance: 625000,
    });
    expect(result.categoryOptions).toEqual([
      { value: "customer_payment", count: 3 },
    ]);
  });

  it("passes every business filter to the read-only RPC", async () => {
    await getCashBookListWorkspace({
      page: 2,
      pageSize: 50,
      search: " PT01 ",
      searchField: "code",
      types: ["receipt"],
      paymentMethods: ["transfer", "card"],
      categories: ["customer_payment"],
      statuses: ["completed"],
      dateFrom: "2026-08-01",
      dateToExclusive: "2026-08-11",
      amountMin: 100000,
      amountMax: 900000,
      branchId: "branch-1",
    });

    expect(rpc).toHaveBeenCalledWith(
      "get_cash_book_list_workspace",
      expect.objectContaining({
        p_page: 2,
        p_page_size: 50,
        p_search: "PT01",
        p_search_field: "code",
        p_types: ["receipt"],
        p_payment_methods: ["transfer", "card"],
        p_categories: ["customer_payment"],
        p_statuses: ["completed"],
        p_date_from: "2026-08-01",
        p_date_to_exclusive: "2026-08-11",
        p_amount_min: 100000,
        p_amount_max: 900000,
        p_branch_id: "branch-1",
      }),
    );
  });

  it("loads all export rows in bounded 200-row pages", async () => {
    rpc
      .mockResolvedValueOnce({
        data: { items: Array.from({ length: 200 }, (_, i) => ({
          id: `cash-${i}`, code: `PT${i}`, transaction_date: "2026-08-10",
          type: "receipt", category: "other", amount: 1, created_by: "user-1",
        })), total: 201, summary: {}, categoryOptions: [] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { items: [{ id: "cash-200", code: "PT200", transaction_date: "2026-08-10", type: "receipt", category: "other", amount: 1, created_by: "user-1" }], total: 201, summary: {}, categoryOptions: [] },
        error: null,
      });

    const rows = await getAllCashBookEntries({ statuses: ["completed"] });
    expect(rows).toHaveLength(201);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "get_cash_book_list_workspace",
      expect.objectContaining({ p_page: 1, p_page_size: 200 }),
    );
  });
});

describe("cash-book workspace contract", () => {
  const root = process.cwd();
  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/00311_cash_book_list_workspace.sql"),
    "utf8",
  );
  const page = fs.readFileSync(
    path.join(root, "src/app/(main)/so-quy/page.tsx"),
    "utf8",
  );

  it("keeps the new database function read-only and server-scoped", () => {
    const sql = migration.replace(/^--.*$/gm, "");
    expect(migration).toContain("stable");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("finance.view_cash_book");
    expect(migration).toContain("reports.view_all_branches");
    expect(migration).toContain("get_user_accessible_branches");
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
  });

  it("uses accounting date, complete export and the compact filter panel", () => {
    expect(migration).toContain("transaction_date");
    expect(page).toContain("getAllCashBookEntries(buildWorkspaceParams())");
    expect(page).toContain('<FilterPanel');
    expect(page).toContain('density="compact"');
    expect(page).toContain('value: "transfer"');
    expect(page).not.toContain('value: "bank"');
  });
});
