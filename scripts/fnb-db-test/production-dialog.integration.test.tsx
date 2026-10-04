import React from "react";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductionOrder } from "@/lib/types";

// This adapter replaces HTTP transport, not the production service or SQL RPC.
// The fixture has bounded permission/reconciliation stubs; this is not an RLS test.
const bridge = vi.hoisted(() => ({ rpc: vi.fn(), detail: vi.fn(), check: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: bridge.rpc }), getCurrentTenantId: vi.fn(), handleError: vi.fn(),
}));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: bridge.toast }), useAuth: () => ({ user: null }) }));
vi.mock("@/lib/services", async () => {
  const production = await import("@/lib/services/supabase/production");
  return {
    completeProductionAtomic: production.completeProductionAtomic,
    getProductionOrderById: bridge.detail, checkMaterialsAvailability: bridge.check,
    getBranches: async () => [], createInternalSale: vi.fn(), syncInternalEntities: vi.fn(),
  };
});
import { CompleteProductionOrderDialog } from "@/components/shared/dialogs/complete-production-order-dialog";

const tenant = "10000000-0000-0000-0000-000000000001";
const branch = "20000000-0000-0000-0000-000000000002";
const raw = "30000000-0000-0000-0000-000000000001";
const prepared = "30000000-0000-0000-0000-000000000002";
const actor = "40000000-0000-0000-0000-000000000001";
const successId = "70000000-0000-0000-0000-000000000003";
const retryId = "70000000-0000-0000-0000-000000000004";
const asyncExec = promisify(execFile);
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"];

function assertDisposable() {
  if (process.env.FNB_UI_DB_TEST !== "1" || process.env.PGHOST !== "localhost"
    || process.env.PGDATABASE !== "fnb_ui_production_test" || process.env.PGUSER !== "postgres"
    || process.env.PGPORT !== "5432" || process.env.PGSERVICE || process.env.PGSERVICEFILE) {
    throw new Error("Only the explicit localhost disposable CI database is allowed");
  }
}
function sql(statement: string) {
  assertDisposable();
  return execFileSync("psql", [...args, "-c", statement], { encoding: "utf8", timeout: 10000 }).trim();
}
function literal(value: unknown) {
  return value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
}
function snapshot() {
  return sql(`select jsonb_build_object(
    'stock', (select jsonb_agg(to_jsonb(s) order by product_id) from branch_stock s),
    'orders', (select jsonb_agg(to_jsonb(o) order by id) from production_orders o),
    'materials', (select jsonb_agg(to_jsonb(m) order by id) from production_order_materials m),
    'lots', (select jsonb_agg(to_jsonb(l) order by id) from product_lots l),
    'movements', (select count(*) from stock_movements),
    'events', (select jsonb_agg(to_jsonb(e) order by id) from fnb_branch_product_cost_events e),
    'costs', (select jsonb_agg(to_jsonb(c) order by product_id) from fnb_branch_product_cost_balances c),
    'audits', (select count(*) from audit_log),
    'reconciliations', (select count(*) from lot_reconciliations));`);
}
function stock(product: string) {
  return Number(sql(`select quantity from branch_stock where branch_id='${branch}' and product_id='${product}' and variant_id is null`));
}
function order(id: string): ProductionOrder {
  return { id, code: id === successId ? "SX-UI-OK" : "SX-UI-RETRY", productId: prepared,
    productName: "Thach UAT", branchId: branch, plannedQty: 10, materials: undefined } as ProductionOrder;
}

beforeAll(() => {
  assertDisposable();
  sql(`insert into production_orders(id, tenant_id, branch_id, product_id, code, created_by, status, planned_qty)
    values ('${successId}','${tenant}','${branch}','${prepared}','SX-UI-OK','${actor}','planned',10),
    ('${retryId}','${tenant}','${branch}','${prepared}','SX-UI-RETRY','${actor}','planned',10);
    insert into production_order_materials(id,production_order_id,product_id,planned_qty,unit,unit_cost)
    values ('71000000-0000-0000-0000-000000000003','${successId}','${raw}',0.5,'Tui',12500),
    ('71000000-0000-0000-0000-000000000004','${retryId}','${raw}',0.5,'Tui',12500);`);
  bridge.detail.mockImplementation(async (id: string) => {
    expect([successId, retryId]).toContain(id);
    const materials = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('productId',product_id,
      'productName','Nguyen lieu UAT','plannedQty',planned_qty,'unit',unit))
      from production_order_materials where production_order_id=${literal(id)}`));
    return { ...order(id), materials };
  });
  bridge.check.mockImplementation(async (branchId: string, materials: { productId: string; productName: string; plannedQty: number; unit: string }[]) => {
    expect(branchId).toBe(branch);
    return materials.map((m) => ({ ...m, needed: m.plannedQty,
      available: stock(m.productId), sufficient: stock(m.productId) >= m.plannedQty }));
  });
  bridge.rpc.mockImplementation(async (name: string, params: Record<string, unknown>) => {
    expect(name).toBe("complete_production_atomic");
    expect([successId, retryId]).toContain(params.p_production_order_id);
    assertDisposable();
    try {
      const { stdout } = await asyncExec("psql", [...args, "-c", `begin;
        set local request.jwt.claim.sub='${actor}';
        select public.complete_production_atomic(
          ${literal(params.p_production_order_id)}::uuid, ${literal(params.p_completed_qty)}::numeric,
          ${literal(params.p_lot_number)}::text, ${literal(params.p_manufactured_date)}::date,
          ${literal(params.p_expiry_date)}::date); commit;`], { timeout: 10000 });
      return { data: stdout.trim(), error: null };
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? "Database completion failed";
      // PostgREST exposes the primary message, not PostgreSQL's function stack.
      return { data: null, error: new Error(stderr.split("\n").find((line) => line.startsWith("ERROR:")) ?? stderr) };
    }
  });
});
afterEach(() => { cleanup(); bridge.toast.mockClear(); bridge.rpc.mockClear(); });

describe("completion dialog connected to the actual production RPC", () => {
  it("posts raw stock, prepared lot and branch cost exactly once from a UI click", async () => {
    const beforeRaw = stock(raw), beforePrepared = stock(prepared);
    const close = vi.fn(), success = vi.fn();
    render(<CompleteProductionOrderDialog open order={order(successId)} onOpenChange={close} onSuccess={success} />);
    await screen.findByText("Đủ NVL");
    fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
    fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(bridge.rpc).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(false);
    expect(stock(raw)).toBe(beforeRaw - 0.5);
    expect(stock(prepared)).toBe(beforePrepared + 10);
    expect(Number(sql(`select cogs_amount from production_orders where id='${successId}'`))).toBe(6250);
    expect(Number(sql(`select current_qty from product_lots where production_order_id='${successId}'`))).toBe(10);
    expect(Number(sql(`select count(*) from fnb_branch_product_cost_events where source_reference_id='${successId}'`))).toBe(2);
    expect(Number(sql(`select count(*) from fnb_branch_product_cost_events where branch_id <> '${branch}'`))).toBe(0);
  });

  it("rolls back a late database failure, keeps input and posts once on explicit retry", async () => {
    sql(`create function public.test_ui_lot_failure() returns trigger language plpgsql as $$ begin
      if new.production_order_id='${retryId}' then
        if not exists(select 1 from stock_movements where reference_id='${retryId}' and type='out') then
          raise exception 'TEST_EXPECTED_CONSUMPTION'; end if;
        raise exception 'TEST_UI_LOT_FAILURE'; end if; return new; end; $$;
      create trigger test_ui_lot_failure before insert on product_lots for each row execute function public.test_ui_lot_failure();`);
    const before = snapshot(), beforeRaw = stock(raw), beforePrepared = stock(prepared);
    const success = vi.fn(), close = vi.fn();
    render(<CompleteProductionOrderDialog open order={order(retryId)} onOpenChange={close} onSuccess={success} />);
    await screen.findByText("Đủ NVL");
    fireEvent.change(screen.getByLabelText("Số lượng thực tế"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
    await waitFor(() => expect(bridge.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error", description: expect.stringContaining("TEST_UI_LOT_FAILURE") })));
    expect(snapshot()).toBe(before);
    expect(success).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Số lượng thực tế")).toHaveValue(12);
    expect(screen.getByRole("button", { name: "Hoàn thành" })).toBeEnabled();
    sql("drop trigger test_ui_lot_failure on product_lots; drop function public.test_ui_lot_failure();");
    fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(bridge.rpc).toHaveBeenCalledTimes(2);
    expect(stock(raw)).toBe(beforeRaw - 0.5);
    expect(stock(prepared)).toBe(beforePrepared + 12);
    expect(Number(sql(`select count(*) from product_lots where production_order_id='${retryId}'`))).toBe(1);
  });
});
