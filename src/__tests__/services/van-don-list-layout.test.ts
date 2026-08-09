import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  "src/app/(main)/don-hang/van-don/page.tsx",
  "utf8",
);

describe("bố cục danh sách Vận đơn", () => {
  it("dùng bố cục gọn và không còn sidebar lọc cố định", () => {
    expect(page).toContain("<ListPageLayout sidebar={null}>");
    expect(page).toContain('title="Vận đơn"');
    expect(page).toContain('density="compact"');
    expect(page).not.toContain("<FilterSidebar>");
    expect(page).not.toContain("<SummaryCard");
  });

  it("giữ đủ ba bộ lọc cũ trong panel phủ", () => {
    expect(page).toContain('title="Bộ lọc vận đơn"');

    for (const [label, value, setter] of [
      ["Trạng thái giao hàng", "statusFilter", "setStatusFilter"],
      ["Đối tác giao hàng", "partnerFilter", "setPartnerFilter"],
      ["Thời gian tạo", "createdDatePreset", "setCreatedDatePreset"],
    ]) {
      expect(page).toContain(`label="${label}"`);
      expect(page).toContain(`value={${value}}`);
      expect(page).toContain(`onChange={${setter}}`);
    }
  });

  it("giữ nguyên giá trị lọc mặc định của production", () => {
    const compactPage = page.replace(/\s+/g, " ");

    for (const declaration of [
      'const [statusFilter, setStatusFilter] = useState("all");',
      'const [partnerFilter, setPartnerFilter] = useState("all");',
      'const [createdDatePreset, setCreatedDatePreset] = useState<DatePresetValue>("all");',
    ]) {
      expect(compactPage).toContain(declaration);
    }
  });

  it("giữ bốn chỉ số và các lệnh nghiệp vụ hiện có", () => {
    for (const label of [
      "Chờ lấy hàng",
      "Đang giao",
      "Đã giao",
      "Hoàn / Hủy",
    ]) {
      expect(page).toContain(`label="${label}"`);
    }

    expect(page).toContain("<CreateShippingOrderDialog");
    expect(page).toContain('label: "Tạo vận đơn"');
    expect(page).toContain('excel: () => handleExport("excel")');
    expect(page).toContain('csv: () => handleExport("csv")');
    expect(page).toContain("buildTransactionRowActions");
    expect(page).toContain("updateShippingOrderStatus");
  });
});
