import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getAuditActionLabel,
  getAuditEntityTypeLabel,
  localizeAuditData,
} from "@/lib/services/supabase/audit";

const page = readFileSync("src/app/(main)/he-thong/audit/page.tsx", "utf8");
const historyTab = readFileSync(
  "src/components/shared/inline-detail-panel/audit-history-tab.tsx",
  "utf8",
);

describe("Vietnamese audit log", () => {
  it("names cancellation rejection and employee benefit groups clearly", () => {
    expect(getAuditActionLabel("fnb_cancel_request_reject")).toBe("Từ chối yêu cầu hủy F&B");
    expect(getAuditActionLabel("employee_benefit_group_save")).toBe("Lưu nhóm ưu đãi nội bộ");
    expect(getAuditEntityTypeLabel("employee_benefit_group")).toBe("Nhóm ưu đãi nội bộ");
  });
  it("translates common ERP and MKT action codes", () => {
    expect(getAuditActionLabel("cash_transaction_created")).toBe(
      "Tạo phiếu thu/chi",
    );
    expect(getAuditActionLabel("soft_delete")).toBe("Xóa mềm");
    expect(getAuditActionLabel("payment")).toBe("Ghi nhận thanh toán");
    expect(getAuditActionLabel("cost_price_update")).toBe("Cập nhật giá vốn");
    expect(getAuditActionLabel("mkt_task_accepted")).toBe(
      "Chấp nhận công việc MKT",
    );
    expect(getAuditActionLabel("mkt_custom_task_started")).toBe(
      "MKT custom công việc đã bắt đầu",
    );
  });

  it("translates entity names and detail fields without mutating source data", () => {
    expect(getAuditEntityTypeLabel("mkt_content_item")).toBe("Nội dung MKT");

    const source = {
      status: "completed",
      product_id: "P-001",
      is_exception: true,
      auto_saved: true,
      atomic: true,
      nested: { reason: "Thiếu hàng" },
    };
    expect(localizeAuditData(source)).toEqual({
      "Trạng thái": "Hoàn thành",
      "Sản phẩm": "P-001",
      "Là ngoại lệ": "Có",
      "Tự động lưu": "Có",
      "Thao tác đồng bộ": "Có",
      Nested: { "Lý do": "Thiếu hàng" },
    });
    expect(source).toEqual({
      status: "completed",
      product_id: "P-001",
      is_exception: true,
      auto_saved: true,
      atomic: true,
      nested: { reason: "Thiếu hàng" },
    });
  });

  it("keeps permission and data reads while standardizing the list layout", () => {
    expect(page).toContain("PERMISSIONS.SYSTEM_VIEW_AUDIT");
    expect(page).toContain("getOperationHistory");
    expect(page).toContain("branchId: scopedBranch");
    expect(page).toContain("<ListPageLayout sidebar={null}>");
    expect(page).toContain('density="compact"');
    expect(page).toContain('title="Bộ lọc lịch sử thao tác"');
    expect(page).toContain('label="Thời gian"');
    expect(page).toContain("STANDARD_LIST_PRESETS_WITH_ALL");
    expect(historyTab).toContain("getAuditFieldLabel");
    expect(historyTab).toContain("localizeAuditData");
  });
});
