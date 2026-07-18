import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reportFiles = [
  "fnb",
  "fnb-modifier",
  "fnb-shipper",
  "tong-hop-kenh",
  "platform-commission",
  "serve-time",
  "tieu-hao-nvl",
  "cogs-theo-bom",
  "doi-chieu-ca",
].map((name) =>
  readFileSync(`src/app/(main)/phan-tich/${name}/page.tsx`, "utf8"),
);

const [
  fnb,
  modifier,
  shipper,
  channels,
  platform,
  serveTime,
  materials,
  cogs,
  shifts,
] = reportFiles;

const fnbAnalytics = readFileSync(
  "src/lib/services/supabase/fnb-analytics.ts",
  "utf8",
);

const chartContainer = readFileSync(
  "src/app/(main)/phan-tich/_components/client-chart-container.tsx",
  "utf8",
);

describe("operations report integrity", () => {
  it("loads delivery staff names without a missing PostgREST relationship", () => {
    expect(fnbAnalytics).toContain("[fnb.deliveryProfiles]");
    expect(fnbAnalytics).not.toContain("profiles!kitchen_orders_delivery_staff_id_fkey");
  });

  it("gives shared charts a stable initial size", () => {
    expect(chartContainer).toContain("initialDimension={{ width: 320, height: 224 }}");
  });

  it("ignores stale responses after period or branch changes", () => {
    for (const source of reportFiles) {
      expect(source).toContain("requestIdRef");
      expect(source).toContain("requestId !== requestIdRef.current");
    }
    expect(shipper).toContain("drillRequestIdRef");
  });

  it("shows the selected period on F&B and cross-channel charts", () => {
    expect(fnb).toContain("formatSelectedPeriodLabel");
    expect(fnb).toContain("subtitle={`${selectedPeriodLabel}");
    expect(channels).toContain("formatSelectedPeriodLabel");
    expect(channels).toContain("Bán lẻ và F&B");
  });

  it("uses clear Vietnamese labels for operational reports", () => {
    expect(platform).toContain('title="Phí nền tảng giao hàng"');
    expect(platform).toContain('label="Phí trả nền tảng"');
    expect(serveTime).toContain('title="Thời gian phục vụ F&B"');
    expect(shipper).toContain('title="Hiệu suất giao hàng nội bộ"');
  });

  it("keeps all table-only operational reports protected", () => {
    expect(modifier).toContain("requestIdRef");
    expect(materials).toContain("requestIdRef");
    expect(cogs).toContain("requestIdRef");
    expect(shifts).toContain("requestIdRef");
  });
});