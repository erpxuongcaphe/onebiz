import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  scopeCategoriesByChannel,
  type CategoryWithChannelBreakdown,
} from "@/lib/services/supabase/categories";

const pageSource = readFileSync(
  "src/app/(main)/hang-hoa/nhom/page.tsx",
  "utf8",
);
const serviceSource = readFileSync(
  "src/lib/services/supabase/categories.ts",
  "utf8",
);

const categories: CategoryWithChannelBreakdown[] = [
  {
    id: "retail",
    name: "SKU Cà phê hạt",
    scope: "sku",
    sortOrder: 0,
    channel: "retail",
    productCount: 27,
    retailCount: 27,
    fnbCount: 0,
  },
  {
    id: "fnb",
    name: "Giải khát",
    scope: "sku",
    sortOrder: 1,
    channel: "fnb",
    productCount: 14,
    retailCount: 0,
    fnbCount: 14,
  },
  {
    id: "legacy",
    name: "Nhóm cũ dùng chung",
    scope: "sku",
    sortOrder: 2,
    productCount: 5,
    retailCount: 3,
    fnbCount: 2,
  },
];

describe("phạm vi nhóm SKU theo kênh chi nhánh", () => {
  it("chi nhánh Retail không thấy nhóm chỉ dành cho FnB", () => {
    const scoped = scopeCategoriesByChannel(categories, "retail");

    expect(scoped.map((item) => item.id)).toEqual(["retail", "legacy"]);
    expect(scoped.find((item) => item.id === "legacy")?.productCount).toBe(3);
  });

  it("chi nhánh FnB không thấy nhóm chỉ dành cho Retail", () => {
    const scoped = scopeCategoriesByChannel(categories, "fnb");

    expect(scoped.map((item) => item.id)).toEqual(["fnb", "legacy"]);
    expect(scoped.find((item) => item.id === "legacy")?.productCount).toBe(2);
  });

  it("Tất cả chi nhánh giữ đủ hai kênh và tổng gốc", () => {
    expect(scopeCategoriesByChannel(categories, null)).toEqual(categories);
  });

  it("trang lấy kênh từ chi nhánh và khóa cả chi tiết sản phẩm", () => {
    expect(pageSource).toContain("getBranchSalesChannel(activeBranchId)");
    expect(pageSource).toContain(
      "getProductsByCategoryId(categoryId, 100, channel)",
    );
    expect(pageSource).toContain("scopeCategoriesByChannel(");
    expect(pageSource).toContain("Kênh được chọn theo chi nhánh đang làm việc.");
  });

  it("dịch vụ thêm điều kiện channel vào truy vấn sản phẩm con", () => {
    expect(serviceSource).toContain(
      'if (channel) query = query.eq("channel", channel)',
    );
  });
});
