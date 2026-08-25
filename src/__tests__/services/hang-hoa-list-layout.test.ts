import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/(main)/hang-hoa/page.tsx", "utf8");

describe("bố cục danh sách Hàng hóa", () => {
  it("không dùng sidebar lọc cố định và bật tiêu đề gọn", () => {
    expect(page).toContain("<ListPageLayout sidebar={null}>");
    expect(page).toContain('title="Hàng hóa"');
    expect(page).toContain('density="compact"');
    expect(page).not.toContain("<FilterSidebar>");
  });

  it("gom bốn chỉ số và công cụ vào dải của bảng", () => {
    expect(page).toContain("toolbarMetrics={");
    expect(page).toContain('isFnbOutletView');
    expect(page).toContain('? "Tổng thành phần"');
    expect(page).toContain(': "Tổng món F&B"');
    expect(page).toContain('? "Tổng NVL"');
    expect(page).toContain(': "Tổng hàng bán"');
    expect(page).toContain('label="Giá trị tồn kho"');
    expect(page).toContain('label="Hết hàng"');
    expect(page).toContain('label="Sắp hết (≤ 5)"');
    expect(page).toContain("toolbarActions={");
    expect(page).toContain("toolbarFooter={");
    expect(page).not.toContain('onClick={() => setStockFilter("out_of_stock")}');
    expect(page).not.toContain('onClick={() => setStockFilter("low_stock")}');
  });

  it("giữ đủ bộ lọc trong panel phủ và thêm lọc sắp hết", () => {
    expect(page).toContain('title="Bộ lọc hàng hóa"');
    for (const label of [
      "Nhóm hàng",
      "Thương hiệu",
      "Tồn kho",
      "Trạng thái kinh doanh",
      "Dự kiến hết hàng",
      "Thời gian tạo",
      "Nhà cung cấp",
    ]) {
      expect(page).toContain(`label="${label}"`);
    }
    expect(page).toContain('{ label: "Sắp hết (≤ 5)", value: "low_stock" }');

    for (const [value, setter] of [
      ["categoryFilter", "setCategoryFilter"],
      ["brandFilter", "setBrandFilter"],
      ["stockFilter", "setStockFilter"],
      ["statusFilter", "setStatusFilter"],
      ["expectedOutDate", "setExpectedOutDate"],
      ["createdDatePreset", "setCreatedDatePreset"],
      ["supplierFilter", "setSupplierFilter"],
    ]) {
      expect(page).toContain(`value={${value}}`);
      expect(page).toContain(`onChange={${setter}}`);
    }
  });

  it("giữ nguyên giá trị lọc mặc định của bản production", () => {
    const compactPage = page.replace(/\s+/g, " ");

    for (const declaration of [
      'const [categoryFilter, setCategoryFilter] = useState("all");',
      'const [stockFilter, setStockFilter] = useState("all");',
      'const [statusFilter, setStatusFilter] = useState("active");',
      'const [brandFilter, setBrandFilter] = useState("all");',
      'const [expectedOutDate, setExpectedOutDate] = useState<DatePresetValue>("all");',
      'const [createdDatePreset, setCreatedDatePreset] = useState<DatePresetValue>("all");',
      'const [supplierFilter, setSupplierFilter] = useState("");',
    ]) {
      expect(compactPage).toContain(declaration);
    }
  });
});
