import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { donConDungDuoc, type ChildSaleInfo } from "@/lib/services/supabase/orders";

/**
 * 21/08/2026 — LỖ HỔNG "HOÀN TẤT XỬ LÝ" GẮN NHẦM ĐƠN CON.
 *
 * Bản cũ: `children.find(c => c.status === "completed") ?? children[0]` — không
 * có đơn nào đã thanh toán thì rơi về ĐƠN ĐẦU DANH SÁCH, tức gắn cả đơn NHÁP
 * hoặc ĐÃ HUỶ rồi báo "đã hoàn tất xử lý" trong khi chưa thu đồng nào.
 * Máy chủ (00333) cũng không kiểm trạng thái — đã đo thật trên PostgreSQL
 * local: bản cũ cho gắn cả nháp/huỷ/void; bản 00337 chặn đủ 3.
 *
 * Ở đây kiểm phía web: nút chỉ bật khi có đơn con DÙNG ĐƯỢC, và đơn con đang
 * gắn mà bị huỷ/void về sau thì màn đơn gốc PHẢI cảnh báo.
 */

const createChildSaleFromOrder = vi.fn();
const getOrderReconciliation = vi.fn();
const markOrderProcessed = vi.fn();
const toastOnDinh = vi.fn();

vi.mock("@/lib/services/supabase", async () => {
  const that = await vi.importActual<typeof import("@/lib/services/supabase/orders")>(
    "@/lib/services/supabase/orders",
  );
  return {
    createChildSaleFromOrder: (...a: unknown[]) => createChildSaleFromOrder(...a),
    getOrderReconciliation: (...a: unknown[]) => getOrderReconciliation(...a),
    markOrderProcessed: (...a: unknown[]) => markOrderProcessed(...a),
    // Bản THẬT — nếu logic sai thì test phải đỏ, không được mock cho dễ.
    donConDungDuoc: that.donConDungDuoc,
  };
});
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: toastOnDinh }) }));

import { ChildSalesBlock } from "@/app/(main)/don-hang/dat-hang/child-sales-block";

function con(
  id: string,
  code: string,
  status: string,
  thua: Partial<ChildSaleInfo> = {},
): ChildSaleInfo {
  return {
    id,
    code,
    status,
    total: 100000,
    paid: 0,
    createdAt: "2026-08-17",
    voidedAt: null,
    cancelledAt: status === "cancelled" ? "2026-08-17" : null,
    ...thua,
  };
}

async function dung(children: ChildSaleInfo[], fulfilledById?: string) {
  getOrderReconciliation.mockResolvedValue({ children, rows: [] });
  render(
    <ChildSalesBlock orderId="dh-1" fulfilledById={fulfilledById} />,
  );
  await waitFor(() => expect(getOrderReconciliation).toHaveBeenCalled());
}

function nutHoanTat() {
  return screen.getByRole("button", { name: /Hoàn tất xử lý/ }) as HTMLButtonElement;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("donConDungDuoc — quy tắc gốc", () => {
  it.each([
    ["nháp", con("c", "NH1", "draft"), false],
    ["đã huỷ", con("c", "NH1", "cancelled"), false],
    ["đã void", con("c", "NH1", "completed", { voidedAt: "2026-08-18" }), false],
    ["completed nhưng có cancelled_at", con("c", "NH1", "completed", { cancelledAt: "2026-08-18" }), false],
    ["đã thanh toán, còn hiệu lực", con("c", "NH1", "completed"), true],
  ])("%s → %s", (_ten, c, mong) => {
    expect(donConDungDuoc(c)).toBe(mong);
  });
});

describe("Nút Hoàn tất xử lý chỉ bật khi có đơn con dùng được", () => {
  it("chỉ có đơn NHÁP: nút TẮT, không gọi RPC", async () => {
    await dung([con("c1", "NH001", "draft")]);
    expect(nutHoanTat().disabled).toBe(true);
    fireEvent.click(nutHoanTat());
    expect(markOrderProcessed).not.toHaveBeenCalled();
  });

  it("chỉ có đơn ĐÃ HUỶ: nút TẮT", async () => {
    await dung([con("c1", "NH001", "cancelled")]);
    expect(nutHoanTat().disabled).toBe(true);
  });

  it("chỉ có đơn ĐÃ VOID: nút TẮT", async () => {
    await dung([con("c1", "NH001", "completed", { voidedAt: "2026-08-18" })]);
    expect(nutHoanTat().disabled).toBe(true);
  });

  it("có nháp + huỷ: nút TẮT kèm giải thích phải làm gì", async () => {
    await dung([con("c1", "NH001", "draft"), con("c2", "NH002", "cancelled")]);
    const nut = nutHoanTat();
    expect(nut.disabled).toBe(true);
    expect(nut.getAttribute("title")).toContain("đã thanh toán");
  });

  it("nhiều đơn con: gắn ĐÚNG đơn đã thanh toán, bỏ qua nháp/huỷ/void đứng trước", async () => {
    markOrderProcessed.mockResolvedValue(undefined);
    await dung([
      con("c1", "NH001", "draft"),
      con("c2", "NH002", "cancelled"),
      con("c3", "NH003", "completed", { voidedAt: "2026-08-18" }),
      con("c4", "NH004", "completed"),
    ]);
    expect(nutHoanTat().disabled).toBe(false);
    fireEvent.click(nutHoanTat());
    fireEvent.click(await screen.findByRole("button", { name: /^Hoàn tất/ }));
    await waitFor(() =>
      expect(markOrderProcessed).toHaveBeenCalledWith("dh-1", "c4"),
    );
  });
});

describe("Đơn con đang gắn bị huỷ/void về sau — phải cảnh báo", () => {
  it("đơn đang gắn bị VOID: hiện cảnh báo và mời Mở lại xử lý", async () => {
    await dung([con("c1", "NH001", "completed", { voidedAt: "2026-08-18" })], "c1");
    const canhBao = await screen.findByRole("alert");
    expect(canhBao.textContent).toContain("NH001");
    expect(canhBao.textContent).toContain("huỷ bỏ hóa đơn");
    expect(canhBao.textContent).toContain("Mở lại xử lý");
  });

  it("đơn đang gắn bị HUỶ: hiện cảnh báo", async () => {
    await dung([con("c1", "NH001", "cancelled")], "c1");
    expect((await screen.findByRole("alert")).textContent).toContain("đã bị huỷ");
  });

  it("đơn đang gắn KHÔNG CÒN trong danh sách: hiện cảnh báo", async () => {
    await dung([con("c2", "NH002", "completed")], "c-da-xoa");
    expect((await screen.findByRole("alert")).textContent).toContain("không còn tồn tại");
  });

  it("đơn đang gắn vẫn hợp lệ: KHÔNG cảnh báo", async () => {
    await dung([con("c1", "NH001", "completed")], "c1");
    await waitFor(() => expect(screen.getByText("NH001")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("đơn con bị void hiện nhãn 'Đã huỷ bỏ hóa đơn', không phải 'Đã thanh toán'", async () => {
    await dung([con("c1", "NH001", "completed", { voidedAt: "2026-08-18" })]);
    expect(await screen.findByText("Đã huỷ bỏ hóa đơn")).toBeTruthy();
    expect(screen.queryByText("Đã thanh toán")).toBeNull();
  });
});

describe("Máy chủ cũng phải chặn — không tin client", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/00337_mark_order_processed_completed_only.sql"),
    "utf8",
  );

  it("00337 thêm đủ 3 điều kiện trạng thái vào mark_order_processed", () => {
    expect(sql).toContain("c.status = 'completed'");
    expect(sql).toContain("c.voided_at is null");
    expect(sql).toContain("c.cancelled_at is null");
  });

  it("giữ nguyên các lớp kiểm của 00332/00333", () => {
    expect(sql).toContain("user_has_branch_access");
    expect(sql).toContain("c.source_order_id = p_order_id");
    expect(sql).toContain("user_has_permission(v_actor, 'orders.create')");
    expect(sql).toContain("set fulfilled_by_id = p_invoice_id");
  });

  it("MỞ LẠI (p_invoice_id null) không bị điều kiện mới chặn", () => {
    // Điều kiện trạng thái nằm trong nhánh `p_invoice_id is not null`.
    const i = sql.indexOf("if p_invoice_id is not null and not exists");
    expect(i).toBeGreaterThan(-1);
    expect(sql.slice(i, sql.indexOf("end $$;", i))).toContain("c.status = 'completed'");
  });

  it("có file hoàn tác", () => {
    const ht = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/00337_rollback_mark_order_processed_completed_only.sql",
      ),
      "utf8",
    );
    expect(ht).toContain("create or replace function public.mark_order_processed");
    expect(ht).not.toContain("c.status = 'completed'");
  });
});
