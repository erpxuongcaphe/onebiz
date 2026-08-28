import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 17/08/2026 — PR4 luồng đơn bán con: màn đơn gốc.
 *
 * Khoá các chốt CEO:
 *   · hiện số đơn con + danh sách mã/trạng thái
 *   · bảng đặt/bán/chênh theo mặt hàng; bán vượt CHỈ cảnh báo nhẹ, không chặn
 *   · "Tạo thêm đơn bán" không giới hạn
 *   · "Hoàn tất xử lý" là nút riêng có xác nhận rõ; hoàn tất rồi vẫn Mở lại
 *   · RPC 00332 chỉ ghi đúng MỘT cột fulfilled_by_id
 */

const createChildSaleFromOrder = vi.fn();
const getOrderReconciliation = vi.fn();
const markOrderProcessed = vi.fn();
const toastOnDinh = vi.fn();

vi.mock("@/lib/services/supabase", () => ({
  createChildSaleFromOrder: (...a: unknown[]) => createChildSaleFromOrder(...a),
  getOrderReconciliation: (...a: unknown[]) => getOrderReconciliation(...a),
  markOrderProcessed: (...a: unknown[]) => markOrderProcessed(...a),
  // Hàm thuần — dùng bản THẬT, không giả, để test không xanh nhờ mock dễ tính.
  donConDungDuoc: (c: { status: string; voidedAt: unknown; cancelledAt: unknown }) =>
    c.status === "completed" && !c.voidedAt && !c.cancelledAt,
}));
vi.mock("@/lib/contexts", () => ({
  useToast: () => ({ toast: toastOnDinh }),
}));

import { ChildSalesBlock } from "@/app/(main)/don-hang/dat-hang/child-sales-block";

function donCon(
  id: string,
  code: string,
  status: string,
  total = 100000,
  thua: { voidedAt?: string | null; cancelledAt?: string | null } = {},
) {
  return {
    id,
    code,
    status,
    total,
    paid: 0,
    createdAt: "2026-08-17",
    voidedAt: thua.voidedAt ?? null,
    cancelledAt: thua.cancelledAt ?? (status === "cancelled" ? "2026-08-17" : null),
    ...thua,
  };
}
function dong(productName: string, qtyOrdered: number, qtySold: number) {
  return {
    productId: productName,
    variantId: null,
    productName,
    unit: "ly",
    qtyOrdered,
    qtySold,
    delta: qtySold - qtyOrdered,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Màn đơn gốc — khối đơn bán con", () => {
  it("hiện số đơn con + mã + trạng thái tiếng Việt", async () => {
    getOrderReconciliation.mockResolvedValue({
      children: [
        donCon("c1", "NH000201", "completed"),
        donCon("c2", "NH000202", "draft"),
        donCon("c3", "NH000203", "cancelled"),
      ],
      rows: [],
    });
    render(<ChildSalesBlock orderId="dh-1" />);

    await waitFor(() => expect(screen.getByText("NH000201")).toBeTruthy());
    expect(screen.getByRole("link", { name: "Mở hóa đơn NH000201" })).toHaveAttribute(
      "href",
      "/don-hang/hoa-don?tim=NH000201&mo=1",
    );
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("Đã thanh toán")).toBeTruthy();
    expect(screen.getByText("Nháp")).toBeTruthy();
    expect(screen.getByText("Đã huỷ")).toBeTruthy();
  });

  it("bán khác số đặt: hiện +chênh và cảnh báo nhẹ nói rõ KHÔNG chặn", async () => {
    getOrderReconciliation.mockResolvedValue({
      children: [donCon("c1", "NH000201", "completed")],
      rows: [dong("Cà phê sữa", 5, 8), dong("Bạc xỉu", 3, 3)],
    });
    render(<ChildSalesBlock orderId="dh-1" />);

    await waitFor(() => expect(screen.getByText("+3")).toBeTruthy());
    expect(screen.getByText(/không chặn lưu, thanh toán hay chốt hoàn tất/)).toBeTruthy();
  });

  it("bán ít hơn số đặt vẫn chỉ là điều chỉnh, không giữ trạng thái đang xử lý", async () => {
    getOrderReconciliation.mockResolvedValue({
      children: [donCon("c1", "NH000201", "completed")],
      rows: [dong("Cà phê sữa", 5, 3)],
    });
    render(<ChildSalesBlock orderId="dh-1" />);

    await waitFor(() => expect(screen.getByText("-2")).toBeTruthy());
    expect(screen.getByText("Có điều chỉnh")).toBeTruthy();
    expect(screen.getByText(/không chặn lưu, thanh toán hay chốt hoàn tất/)).toBeTruthy();
  });

  it("bán đúng số đặt: KHÔNG hiện cảnh báo điều chỉnh", async () => {
    getOrderReconciliation.mockResolvedValue({
      children: [donCon("c1", "NH000201", "completed")],
      rows: [dong("Cà phê sữa", 5, 5)],
    });
    render(<ChildSalesBlock orderId="dh-1" />);

    await waitFor(() => expect(screen.getByText("Cà phê sữa")).toBeTruthy());
    expect(screen.queryByText("Có điều chỉnh")).toBeNull();
  });

  it("Tạo thêm đơn bán: gọi service, xong tải lại đối chiếu", async () => {
    getOrderReconciliation.mockResolvedValue({ children: [], rows: [] });
    createChildSaleFromOrder.mockResolvedValue({
      childId: "c-x",
      childCode: "NH000210",
      clientSessionId: "s",
      draftRevision: 0,
      itemCount: 2,
      sourceOrderId: "dh-1",
      sourceOrderCode: "DH000042",
    });
    render(<ChildSalesBlock orderId="dh-1" />);
    await waitFor(() => expect(screen.getByText("Tạo thêm đơn bán")).toBeTruthy());

    fireEvent.click(screen.getByText("Tạo thêm đơn bán"));
    await waitFor(() =>
      expect(createChildSaleFromOrder).toHaveBeenCalledWith("dh-1"),
    );
    // Tải lại sau khi tạo (1 lần mount + 1 lần sau tạo).
    await waitFor(() =>
      expect(getOrderReconciliation).toHaveBeenCalledTimes(2),
    );
  });

  it("Hoàn tất xử lý: có XÁC NHẬN rõ rồi mới gọi RPC với đơn con completed", async () => {
    getOrderReconciliation.mockResolvedValue({
      children: [donCon("c-nhap", "NH000201", "draft"), donCon("c-xong", "NH000202", "completed")],
      rows: [],
    });
    markOrderProcessed.mockResolvedValue(undefined);
    render(<ChildSalesBlock orderId="dh-1" />);
    await waitFor(() => expect(screen.getByText("Hoàn tất xử lý")).toBeTruthy());

    fireEvent.click(screen.getByText("Hoàn tất xử lý"));
    // Chưa gọi RPC — phải qua xác nhận trước.
    expect(markOrderProcessed).not.toHaveBeenCalled();
    expect(screen.getByText("Hoàn tất xử lý đơn đặt hàng?")).toBeTruthy();
    expect(screen.getByText(/Doanh thu, kho, công nợ KHÔNG đổi/)).toBeTruthy();

    fireEvent.click(screen.getByText("Hoàn tất"));
    // Ưu tiên gắn đơn con ĐÃ THANH TOÁN, không phải đơn đầu danh sách.
    await waitFor(() =>
      expect(markOrderProcessed).toHaveBeenCalledWith("dh-1", "c-xong"),
    );
  });

  it("chưa có đơn con nào: nút Hoàn tất bị khoá", async () => {
    getOrderReconciliation.mockResolvedValue({ children: [], rows: [] });
    render(<ChildSalesBlock orderId="dh-1" />);
    await waitFor(() => expect(screen.getByText("Hoàn tất xử lý")).toBeTruthy());
    const nut = screen.getByText("Hoàn tất xử lý").closest("button")!;
    expect(nut.disabled).toBe(true);
  });

  it("đã hoàn tất: hiện Mở lại xử lý, xác nhận rồi gọi RPC với null", async () => {
    getOrderReconciliation.mockResolvedValue({
      children: [donCon("c1", "NH000201", "completed")],
      rows: [],
    });
    markOrderProcessed.mockResolvedValue(undefined);
    render(<ChildSalesBlock orderId="dh-1" fulfilledById="hd-cu" />);
    await waitFor(() => expect(screen.getByText("Mở lại xử lý")).toBeTruthy());
    // Đã hoàn tất vẫn tạo thêm được — không mất nút.
    expect(screen.getByText("Tạo thêm đơn bán")).toBeTruthy();

    fireEvent.click(screen.getByText("Mở lại xử lý"));
    fireEvent.click(screen.getByText("Mở lại"));
    await waitFor(() =>
      expect(markOrderProcessed).toHaveBeenCalledWith("dh-1", null),
    );
  });

  it("máy chủ chưa bật 00331 (null): khối tự ẩn, không vẽ gì", async () => {
    getOrderReconciliation.mockResolvedValue(null);
    const { container } = render(<ChildSalesBlock orderId="dh-1" />);
    await waitFor(() => expect(getOrderReconciliation).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});

describe("SQL 00332 + 00333 — bất biến (kèm phạm vi chi nhánh)", () => {
  const docSql = (p: string) =>
    readFileSync(p, "utf8")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((d) => !d.trim().startsWith("--"))
      .join("\n");
  // 00332 (bản cài mới) và 00333 (bản bổ sung cho prod đã chạy bản thiếu)
  // phải CÙNG một thân hàm — kiểm cả hai để không lệch nhau.
  const CAC_BAN: Array<[string, string]> = [
    ["00332", docSql("supabase/migrations/00332_mark_order_processed.sql")],
    ["00333", docSql("supabase/migrations/00333_mark_order_processed_branch_scope.sql")],
  ];

  it.each(CAC_BAN)("%s: chỉ ghi đúng MỘT cột fulfilled_by_id, không đụng status/tiền", (_ten, THAN) => {
    expect(THAN).toContain("set fulfilled_by_id = p_invoice_id");
    const doanUpdate = THAN.slice(THAN.indexOf("update public.invoices"));
    const cauUpdate = doanUpdate.slice(0, doanUpdate.indexOf(";"));
    expect(cauUpdate).not.toMatch(/status\s*=/);
    expect(cauUpdate).not.toMatch(/total\s*=/);
    expect(cauUpdate).not.toMatch(/paid\s*=/);
  });

  it.each(CAC_BAN)("%s: 4 tình huống phạm vi — owner / đúng CN / khác CN / khác tenant", (_ten, THAN) => {
    // Owner + nhân viên đúng/khác chi nhánh: cùng helper chuẩn 00265.
    // Định nghĩa thật (00050): TRUE khi role='owner' HOẶC branch_id khớp
    // HOẶC có dòng user_branches — role 'admin' KHÔNG tự qua.
    expect(THAN).toContain("public.user_has_branch_access(v_actor, v_don.branch_id)");
    expect(THAN).toContain("chi nhanh cua don nay");
    // UUID khác tenant: lọc tenant ngay trong SELECT đơn gốc → not found.
    expect(THAN).toMatch(/where i\.id = p_order_id and i\.tenant_id = v_tenant/);
    // Hoá đơn con gắn vào phải ĐÚNG chi nhánh của đơn gốc.
    expect(THAN).toContain("c.branch_id = v_don.branch_id");
  });

  it.each(CAC_BAN)("%s: đơn con đúng nguồn gốc + quyền orders.create + chặn anon", (_ten, THAN) => {
    expect(THAN).toContain("c.source_order_id = p_order_id");
    expect(THAN).toContain("user_has_permission(v_actor, 'orders.create')");
    expect(THAN).toMatch(/revoke all on function public\.mark_order_processed/);
  });

  it.each(CAC_BAN)("%s: hậu kiểm trong migration tự bắt thiếu kiểm chi nhánh", (_ten, THAN) => {
    const hauKiem = THAN.slice(THAN.indexOf("do $$"));
    expect(hauKiem).toContain("user_has_branch_access");
    expect(hauKiem).toContain("pg_get_functiondef");
  });
});
