import { describe, expect, it, vi } from "vitest";
import { getMktDashboardData } from "@/lib/mkt/dashboard";

function createQuery(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function createSupabaseMock(options: {
  user?: { id: string } | null;
  tables?: Record<string, unknown>;
  errors?: Record<string, unknown>;
}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.user ?? { id: "user-1" } },
        error: null,
      }),
    },
    from: vi.fn((table: string) =>
      createQuery(options.tables?.[table] ?? [], options.errors?.[table] ?? null),
    ),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
}

describe("getMktDashboardData", () => {
  it("returns an empty dashboard for unauthenticated users", async () => {
    const supabase = createSupabaseMock({ user: null });

    const data = await getMktDashboardData(
      supabase as unknown as Parameters<typeof getMktDashboardData>[0],
    );

    expect(data.tenantId).toBeNull();
    expect(data.readinessScore).toBe(0);
    expect(data.metrics.map((item) => item.value)).toEqual(["0", "0", "0", "0"]);
  });

  it("keeps readiness at 0 when the tenant has no campaign checklist", async () => {
    const supabase = createSupabaseMock({
      tables: {
        profiles: {
          id: "user-1",
          tenant_id: "tenant-1",
          full_name: "MKT Lead",
          email: "lead@example.com",
        },
        mkt_campaigns: [],
        mkt_tasks: [],
        mkt_content_items: [],
      },
    });

    const data = await getMktDashboardData(
      supabase as unknown as Parameters<typeof getMktDashboardData>[0],
    );

    expect(data.isConfigured).toBe(true);
    expect(data.tenantId).toBe("tenant-1");
    expect(data.readinessScore).toBe(0);
    expect(data.readiness).toEqual([]);
  });

  it("marks the dashboard as not configured when MKT tables are missing", async () => {
    const supabase = createSupabaseMock({
      tables: {
        profiles: {
          id: "user-1",
          tenant_id: "tenant-1",
          full_name: "MKT Lead",
          email: "lead@example.com",
        },
        mkt_tasks: [],
        mkt_content_items: [],
      },
      errors: {
        mkt_campaigns: {
          code: "42P01",
          message: 'relation "public.mkt_campaigns" does not exist',
        },
      },
    });

    const data = await getMktDashboardData(
      supabase as unknown as Parameters<typeof getMktDashboardData>[0],
    );

    expect(data.isConfigured).toBe(false);
    expect(data.warnings.join("\n")).toContain("42P01");
  });
});
