import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FulfilledOrderStatus } from "@/app/(main)/don-hang/dat-hang/order-fulfillment-status";
import { NHAN_TRANG_THAI_XU_LY } from "@/lib/services/supabase/orders";

describe("Trạng thái chốt đơn đặt hàng nhiều hóa đơn", () => {
  it("hiện toàn bộ mã hóa đơn còn hiệu lực và mỗi mã mở được", () => {
    render(
      <FulfilledOrderStatus
        invoiceCodes={["HD001601", "HD001602", "HD001601"]}
      />,
    );

    expect(screen.getByText("Đã có hóa đơn số")).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "Mở hóa đơn HD001601" }),
    ).toHaveAttribute("href", "/don-hang/hoa-don?tim=HD001601&mo=1");
    expect(
      screen.getByRole("link", { name: "Mở hóa đơn HD001602" }),
    ).toHaveAttribute("href", "/don-hang/hoa-don?tim=HD001602&mo=1");
  });

  it("trạng thái nội bộ không dùng từ chưa chốt trên nhãn quản trị", () => {
    expect(NHAN_TRANG_THAI_XU_LY.dang_xu_ly.nhan).toBe("Đã có hóa đơn");
    expect(NHAN_TRANG_THAI_XU_LY.dang_xu_ly.mo_ta).toContain(
      "chưa xác nhận kết thúc xử lý nội bộ",
    );
  });
});

describe("00358 - nhật ký chốt không phụ thuộc số lượng", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/00358_order_finalization_audit.sql",
    ),
    "utf8",
  );
  const rollback = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/00358_rollback_order_finalization_audit.sql",
    ),
    "utf8",
  );

  it("giữ guard hóa đơn con completed/cùng tenant/chi nhánh và khóa anon", () => {
    expect(sql).toContain("c.source_order_id = p_order_id");
    expect(sql).toContain("c.branch_id = v_don.branch_id");
    expect(sql).toContain("c.status = 'completed'");
    expect(sql).toContain("c.voided_at is null");
    expect(sql).toContain("c.cancelled_at is null");
    expect(sql).toContain(
      "revoke all on function public.mark_order_processed(uuid, uuid) from public, anon",
    );
  });

  it("chỉ cập nhật fulfilled_by_id và ghi audit người/thời điểm/danh sách hóa đơn", () => {
    const update = sql.slice(sql.indexOf("update public.invoices"));
    const statement = update.slice(0, update.indexOf(";"));
    expect(statement).toContain("set fulfilled_by_id = p_invoice_id");
    expect(statement).not.toMatch(/status\s*=/);
    expect(statement).not.toMatch(/total\s*=/);
    expect(statement).not.toMatch(/paid\s*=/);
    expect(sql).toContain("insert into public.audit_log");
    expect(sql).toContain("sales_order_processing_completed");
    expect(sql).toContain("sales_order_processing_reopened");
    expect(sql).toContain("'invoice_codes', to_jsonb(v_invoice_codes)");
    expect(sql).toContain("'quantity_match_required', false");
  });

  it("không đọc invoice_items để bắt khớp số lượng", () => {
    expect(sql).not.toMatch(/(?:from|join|update)\s+public\.invoice_items/i);
  });

  it("migration và rollback đều nguyên tử, notify sau commit", () => {
    for (const body of [sql, rollback]) {
      expect(body).toMatch(/begin;[\s\S]*commit;[\s\S]*notify pgrst/);
    }
  });
});
