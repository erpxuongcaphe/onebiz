import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FnbReadinessBand } from "@/app/(main)/hang-hoa/tuy-chon-fnb/fnb-readiness-band";
import type { FnbReadiness } from "@/lib/services/supabase/fnb-readiness";

const readiness: FnbReadiness = {
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

    expect(screen.getByText("Xem việc cần xử lý (2)")).toBeInTheDocument();
    expect(screen.getByText("SKU-TPP-012 · Trân Châu Trắng")).toBeInTheDocument();
    expect(screen.getByText("Thiếu giá bán · Thiếu công thức")).toBeInTheDocument();
    expect(screen.getByText("Có nhiều lựa chọn mặc định")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mở" })).toHaveAttribute(
      "href",
      "/hang-hoa?scope=sku&search=SKU-TPP-012",
    );
  });
});
