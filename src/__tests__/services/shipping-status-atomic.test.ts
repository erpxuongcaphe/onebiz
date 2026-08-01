import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getCurrentContext: vi.fn(),
  getCurrentTenantId: vi.fn(),
  getPaginationRange: vi.fn(),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));

import { updateShippingOrderStatus } from "@/lib/services/supabase/shipping";

const migration = readFileSync(
  "supabase/migrations/00276_atomic_shipping_status.sql",
  "utf8",
);
const service = readFileSync("src/lib/services/supabase/shipping.ts", "utf8");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: {
      id: "ship-1",
      code: "VD001",
      status: "in_transit",
      receiver_name: "Khach hang",
      receiver_phone: "0900000000",
      receiver_address: "Dia chi",
      shipping_fee: 20_000,
      cod_amount: 500_000,
      created_at: "2026-07-31T00:00:00Z",
      updated_at: "2026-07-31T01:00:00Z",
      invoices: { code: "HD001" },
      delivery_partners: { name: "Doi tac" },
    },
    error: null,
  });
});

describe("atomic shipping status", () => {
  it("uses one server transition", async () => {
    const result = await updateShippingOrderStatus("ship-1", "in_transit", "Da nhan");
    expect(result.status).toBe("in_transit");
    expect(rpc).toHaveBeenCalledWith("update_shipping_order_status_atomic", {
      p_shipping_order_id: "ship-1",
      p_next_status: "in_transit",
      p_note: "Da nhan",
    });
  });

  it("checks permission, branch, state and audit in SQL", () => {
    expect(migration).toContain("for update of so");
    expect(migration).toContain("orders.cancel");
    expect(migration).toContain("orders.create");
    expect(migration).toContain("user_has_branch_access");
    expect(migration).toContain("SHIPPING_STATUS_TRANSITION_INVALID");
    expect(migration).toContain("shipping_order");
    expect(migration).toContain("'atomic', true");
  });

  it("does not update shipping and audit separately in the browser service", () => {
    expect(service).toContain('"update_shipping_order_status_atomic"');
    const implementation = service.slice(
      service.indexOf("export async function updateShippingOrderStatus("),
      service.indexOf("// --- Write Operations ---"),
    );
    expect(implementation).not.toContain('.from("shipping_orders")');
    expect(implementation).not.toContain('.from("audit_log")');
  });
});
