import { describe, it, expect, vi } from "vitest";

// Mock supabase base + branches để import không lỗi
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(), maybeSingle: vi.fn() })),
    })),
  }),
  getCurrentContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1" })),
  getCurrentTenantId: () => Promise.resolve("t1"),
  handleError: (err: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${err.message}`);
  },
}));

vi.mock("@/lib/services/supabase/branches", () => ({
  getBranches: vi.fn(async () => []),
}));

import { splitPeriod } from "@/lib/services/supabase/kpi-engine";

describe("splitPeriod", () => {
  describe("daily", () => {
    it("chia đúng 1 ngày thành 1 range", () => {
      const r = splitPeriod("2026-04-19", "2026-04-19", "daily");
      expect(r.length).toBe(1);
      expect(r[0].start).toBe("2026-04-19");
      expect(r[0].end).toBe("2026-04-19");
    });

    it("chia 7 ngày thành 7 range", () => {
      const r = splitPeriod("2026-04-01", "2026-04-07", "daily");
      expect(r.length).toBe(7);
      expect(r[0].start).toBe("2026-04-01");
      expect(r[6].start).toBe("2026-04-07");
    });

    it("trả mảng rỗng nếu end < start", () => {
      const r = splitPeriod("2026-04-10", "2026-04-01", "daily");
      expect(r.length).toBe(0);
    });
  });

  describe("weekly", () => {
    it("chia tháng 4 tuần thành các tuần đầy đủ/clipped", () => {
      // 01/04/2026 = thứ 4, 30/04 = thứ 5
      const r = splitPeriod("2026-04-01", "2026-04-30", "weekly");
      expect(r.length).toBeGreaterThanOrEqual(4);
      expect(r[0].start).toBe("2026-04-01"); // clipped start
      expect(r[r.length - 1].end).toBe("2026-04-30"); // clipped end
    });
  });

  describe("monthly", () => {
    it("chia quý Q2 thành 3 tháng 4/5/6", () => {
      const r = splitPeriod("2026-04-01", "2026-06-30", "monthly");
      expect(r.length).toBe(3);
      expect(r[0].start).toBe("2026-04-01");
      expect(r[0].end).toBe("2026-04-30");
      expect(r[1].start).toBe("2026-05-01");
      expect(r[1].end).toBe("2026-05-31");
      expect(r[2].start).toBe("2026-06-01");
      expect(r[2].end).toBe("2026-06-30");
    });

    it("chia năm 2026 thành 12 tháng", () => {
      const r = splitPeriod("2026-01-01", "2026-12-31", "monthly");
      expect(r.length).toBe(12);
      expect(r[0].label).toBe("Tháng 1/2026");
      expect(r[11].label).toBe("Tháng 12/2026");
    });
  });

  describe("quarterly", () => {
    it("chia năm 2026 thành 4 quý", () => {
      const r = splitPeriod("2026-01-01", "2026-12-31", "quarterly");
      expect(r.length).toBe(4);
      expect(r[0].label).toBe("Q1/2026");
      expect(r[0].start).toBe("2026-01-01");
      expect(r[0].end).toBe("2026-03-31");
      expect(r[3].label).toBe("Q4/2026");
      expect(r[3].start).toBe("2026-10-01");
      expect(r[3].end).toBe("2026-12-31");
    });

    it("chia 6 tháng (nửa năm sau) thành 2 quý", () => {
      const r = splitPeriod("2026-07-01", "2026-12-31", "quarterly");
      expect(r.length).toBe(2);
      expect(r[0].label).toBe("Q3/2026");
      expect(r[1].label).toBe("Q4/2026");
    });
  });

  describe("yearly (không ý nghĩa làm sub-period)", () => {
    it("trả về mảng rỗng", () => {
      const r = splitPeriod("2026-01-01", "2026-12-31", "yearly");
      expect(r.length).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("monthly với range 1 ngày", () => {
      const r = splitPeriod("2026-04-19", "2026-04-19", "monthly");
      expect(r.length).toBe(1);
      expect(r[0].start).toBe("2026-04-19");
      expect(r[0].end).toBe("2026-04-19");
    });

    it("quarterly với range cross-year", () => {
      const r = splitPeriod("2026-11-01", "2027-02-28", "quarterly");
      expect(r.length).toBe(2);
      expect(r[0].label).toBe("Q4/2026");
      expect(r[1].label).toBe("Q1/2027");
    });
  });
});
