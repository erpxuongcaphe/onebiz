import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeChannelSales } from "@/lib/utils/channel-report";

describe("channel sales report", () => {
  it("attributes linked orders by invoice date and uninvoiced orders by order date", () => {
    const source = readFileSync("src/lib/services/supabase/analytics.ts", "utf8");
    expect(source).toContain('.in("invoice_id", ids)');
    expect(source).toContain('.is("invoice_id", null)');
    expect(source).toContain('if (!branchId) {');
  });

  it("counts an invoiced online order once, on its online channel", () => {
    expect(summarizeChannelSales(
      [{ id: "counter", total: 50 }, { id: "online", total: 120 }],
      [{ channel_name: "Website", total_amount: 125, invoice_id: "online" }],
    )).toEqual([
      { channel: "Tại quầy", revenue: 50, orders: 1, avgValue: 50 },
      { channel: "Website", revenue: 120, orders: 1, avgValue: 120 },
    ]);
  });

  it("keeps an uninvoiced online order and deduplicates repeated invoice links", () => {
    expect(summarizeChannelSales(
      [{ id: "online", total: 100 }],
      [
        { channel_name: "Website", total_amount: 110, invoice_id: "online" },
        { channel_name: "Website", total_amount: 110, invoice_id: "online" },
        { channel_name: "Zalo", total_amount: 30, invoice_id: null },
      ],
    )).toEqual([
      { channel: "Tại quầy", revenue: 0, orders: 0, avgValue: 0 },
      { channel: "Website", revenue: 100, orders: 1, avgValue: 100 },
      { channel: "Zalo", revenue: 30, orders: 1, avgValue: 30 },
    ]);
  });
});
