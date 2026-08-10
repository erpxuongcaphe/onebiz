import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  "src/app/(main)/don-hang/dat-hang/page.tsx",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/00306_kpi_don_dat_hang_summary.sql",
  "utf8",
);
const preflight = readFileSync(
  "docs/PREFLIGHT-KPI-DON-DAT-HANG-2026-08-10.sql",
  "utf8",
);

describe("bố cục và bộ lọc Đơn đặt hàng", () => {
  it("dùng bố cục gọn, không còn sidebar hay thẻ KPI cao", () => {
    expect(page).toContain("<ListPageLayout sidebar={null}>");
    expect(page).toContain('title="Đặt hàng"');
    expect(page).toContain('density="compact"');
    expect(page).not.toContain("<FilterSidebar>");
    expect(page).not.toContain("<SummaryCard");
  });

  it("giữ bộ lọc nghiệp vụ đầy đủ nhưng chỉ dùng dữ liệu thật", () => {
    for (const label of [
      "Thời gian tạo đơn",
      "Trạng thái",
      "Tình trạng xuất hóa đơn",
      "Công nợ",
      "Giá trị đơn",
      "Tình trạng vận đơn",
      "Đối tác giao hàng",
      "Thời gian tạo vận đơn",
      "Địa chỉ giao hàng",
    ]) {
      expect(page).toContain(`label="${label}"`);
    }
    expect(page).toContain("getPartnerOptionsAsync");
    expect(page).toContain('placeholder="Tỉnh, quận hoặc địa chỉ"');
    expect(page).not.toContain("Giao Hàng Nhanh");
    expect(page).not.toContain("Miền Bắc");
  });

  it("hai bộ lọc ngày đều hỗ trợ khoảng tùy chỉnh thật", () => {
    for (const marker of [
      "from={dateFrom}",
      "to={dateTo}",
      "onFromChange={setDateFrom}",
      "onToChange={setDateTo}",
      "from={deliveryDateFrom}",
      "to={deliveryDateTo}",
      "onFromChange={setDeliveryDateFrom}",
      "onToChange={setDeliveryDateTo}",
    ]) {
      expect(page).toContain(marker);
    }
  });

  it("bảng và KPI cùng dùng phạm vi quyền hiệu lực", () => {
    expect(page).toContain("phamViDonDatHang");
    expect(page).toContain("getOrdersTheoPhamVi");
    expect(page).toContain("getChiSoDonDatHangTheoPhamVi");
    expect(page).toContain('"reports.view_all_branches"');
    expect(page).toContain('"system.manage_branches"');
  });

  it("kết quả danh sách cũ về muộn không được ghi đè bộ lọc mới", () => {
    expect(page).toContain("const luot = ++fetchLuotRef.current");
    expect(page).toContain("if (luot !== fetchLuotRef.current) return");
    expect(page).toContain(
      "if (luot === fetchLuotRef.current) setLoading(false)",
    );
  });

  it("sau mọi thao tác đổi đơn đều làm mới cả bảng và KPI", () => {
    for (const marker of [
      "onSuccess={taiLaiSauKhiDoiDuLieu}",
      "onDataChanged={taiLaiSauKhiDoiDuLieu}",
      "onDone={taiLaiSauKhiDoiDuLieu}",
      "await taiLaiSauKhiDoiDuLieu();",
    ]) {
      expect(page).toContain(marker);
    }
  });
});

describe("migration 00306 chỉ đọc và khóa phạm vi", () => {
  const codeOnly = migration.replace(/^\s*--.*$/gm, "");
  const functionDefinition = migration.split("with function_check as (")[0];

  it("chỉ tạo một hàm STABLE, không có câu lệnh đổi dữ liệu", () => {
    expect(migration).toContain(
      "create or replace function public.get_sales_order_list_summary",
    );
    expect(migration).toMatch(/\blanguage plpgsql\s+stable\b/i);
    expect(migration).not.toMatch(/security\s+definer/i);
    expect(migration).toContain("notify pgrst, 'reload schema'");
    expect(codeOnly).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
    expect(codeOnly).not.toMatch(/\balter\s+table\b/i);
    expect(codeOnly).not.toMatch(/\bcreate\s+trigger\b/i);
  });

  it("tenant, hồ sơ, quyền chi nhánh và vận đơn đều được chốt máy chủ", () => {
    for (const guard of [
      "auth.uid()",
      "public.get_user_tenant_id()",
      "coalesce(p.is_active, true)",
      "public.user_has_permission",
      "public.user_has_branch_access",
      "public.get_user_accessible_branches",
      "from public.customers c",
      "so.tenant_id = v_tenant",
      "exists (",
    ]) {
      expect(migration).toContain(guard);
    }
    expect(functionDefinition).not.toContain("i.customer_phone");
  });

  it("preflight kiểm SĐT ở bảng khách hàng, không đòi cột cũ trên hóa đơn", () => {
    expect(preflight).toContain("('customers', 'phone')");
    expect(preflight).not.toContain("('invoices', 'customer_phone')");
  });
});
