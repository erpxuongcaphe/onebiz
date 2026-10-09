import { beforeEach, describe, expect, it, vi } from "vitest";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/supabase/print-templates-engine", () => ({ resolvePrintTemplate: resolve }));
import { resolveBranchPrintTestBuilder } from "@/lib/printer/print-test-template";
beforeEach(() => vi.clearAllMocks());
describe("branch print test uses the saved template", () => {
  it.each(["cashier", "kitchen", "bar-station"])("uses branch typography and margins for %s without producing a payable test QR", async key => {
    resolve.mockResolvedValue({ config: { thermal: { itemSize: 21, detailSize: 15, italicDetails: false, bottomMarginMm: 18 }, footer: { customText: "Custom footer" } }, brand: {} });
    const build = await resolveBranchPrintTestBuilder("branch-xtb", { key, label: "Quầy", paper: "80mm", printer: "saved" }, "compact", "2026-10-09T02:00:00Z");
    expect(resolve).toHaveBeenCalledWith("fnb", key === "cashier" ? "sale_invoice" : "kitchen_ticket", "branch-xtb");
    for (const paper of ["58mm", "80mm"] as const) {
      const html = build(paper);
      expect(html).toMatch(/font-size:\s*21px/);
      expect(html).toContain("padding-bottom:18mm");
      expect(html).toContain("font-style:normal");
      expect(html).toContain("TEST-ONEBIZ");
      expect(html).toContain("Cà phê sữa đá");
      expect(html).not.toContain("vietqr.io");
    }
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it("uses the built-in ticket when no branch or shared template exists", async () => {
    resolve.mockResolvedValue(null);
    const build = await resolveBranchPrintTestBuilder("branch", { key: "kitchen", label: "Bếp", paper: "58mm", printer: "saved" }, "compact", "2026-10-09T02:00:00Z");
    expect(build("58mm")).toContain("padding-bottom:12mm");
    expect(build("58mm")).toContain("DỮ LIỆU THỬ — KHÔNG GHI DOANH THU");
  });
});
