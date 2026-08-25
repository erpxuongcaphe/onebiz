import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FnbReadinessBand } from "@/app/(main)/hang-hoa/tuy-chon-fnb/fnb-readiness-band";
import type { FnbReadiness } from "@/lib/services/supabase/fnb-readiness";

const readiness: FnbReadiness = {
  menuTotal: 124,
  simpleProductsMissingPrice: 123,
  simpleProductsMissingBom: 0,
  variantsTotal: 2,
  variantsMissingPrice: 2,
  variantsMissingBom: 2,
  variantProductsWithInvalidDefaults: 0,
  activeKitchenStations: 0,
  activeTables: 0,
  menuIssues: [
    {
      id: "menu-1",
      code: "FNB-001",
      name: "Cà phê sữa",
      missingPrice: true,
      missingBom: false,
    },
  ],
  toppingTotal: 14,
  toppingReady: 0,
  toppingMissingPrice: 14,
  toppingMissingBom: 14,
  singleGroupsWithManyDefaults: 1,
  conflictingStockOptions: 1,
  legacyToppingGroups: 1,
  toppingSkuEnabled: false,
  toppingIssues: [
    {
      id: "p12",
      code: "SKU-TPP-012",
      name: "Trân Châu Trắng",
      missingPrice: true,
      missingBom: true,
    },
  ],
  configurationIssues: [
    { type: "many_defaults", groupName: "Mức đường" },
  ],
};

describe("FnbReadinessBand", () => {
  it("hiện đúng việc cần xử lý và dẫn tới SKU cần cấu hình", () => {
    render(
      <FnbReadinessBand
        readiness={readiness}
        loading={false}
        error={false}
        branchName="Xưởng Premium"
      />,
    );

    expect(screen.getByText("Xem việc cần xử lý (3)")).toBeInTheDocument();
    expect(screen.getByText("FNB-001 · Cà phê sữa")).toBeInTheDocument();
    expect(screen.getAllByText("Chưa có trạm bếp đang bật")).not.toHaveLength(0);
    expect(screen.queryByText("SKU-TPP-012 · Trân Châu Trắng")).not.toBeInTheDocument();
    expect(screen.queryByText("Thiếu giá bán · Thiếu công thức")).not.toBeInTheDocument();
    expect(screen.getByText("Có nhiều lựa chọn mặc định")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mở" })).toHaveAttribute(
      "href",
      "/hang-hoa?scope=sku&search=FNB-001",
    );
  });

  it("nêu rõ khi món nhiều cỡ chưa có đúng một cỡ mặc định", () => {
    render(
      <FnbReadinessBand
        readiness={{ ...readiness, variantProductsWithInvalidDefaults: 2 }}
        loading={false}
        error={false}
      />,
    );

    expect(screen.getByText("Xem việc cần xử lý (4)")).toBeInTheDocument();
    expect(screen.getByText("Cỡ mặc định chưa hợp lệ")).toBeInTheDocument();
    expect(
      screen.getByText("2 món có nhiều cỡ phải chọn đúng một cỡ mặc định."),
    ).toBeInTheDocument();
  });
});
