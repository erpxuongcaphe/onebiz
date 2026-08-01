#!/usr/bin/env node

/**
 * READ-ONLY: đối chiếu tồn chi nhánh với sổ lô FIFO.
 *
 * Công cụ chỉ gọi SELECT qua Supabase. Không gọi RPC và không ghi dữ liệu.
 * Dùng QC_TENANT_ID để kiểm tra tenant khác khi cần.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(join(process.cwd(), ".env.local"));
loadEnv(join(process.cwd(), ".env"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tenantId =
  process.env.QC_TENANT_ID || "148e8ac5-b891-4de3-9055-cfa41f39ddb0";

if (!url || !serviceKey) {
  throw new Error(
    "Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong env.",
  );
}

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function selectAll(table, columns, configure = (query) => query) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const query = configure(
      db.from(table).select(columns).eq("tenant_id", tenantId),
    ).range(from, from + pageSize - 1);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return rows;
  }
}

const number = (value) => Number(value ?? 0);
const pairKey = (row) => `${row.branch_id}|${row.product_id}`;

async function main() {
  const [branchStock, lots, products, branches] = await Promise.all([
    selectAll(
      "branch_stock",
      "branch_id,product_id,variant_id,quantity,updated_at",
      (query) => query.is("variant_id", null),
    ),
    selectAll(
      "product_lots",
      "id,branch_id,product_id,lot_number,source_type,status,initial_qty,current_qty,expiry_date,received_date,created_at,updated_at",
    ),
    selectAll("products", "id,code,name,unit,is_active"),
    selectAll("branches", "id,code,name,is_active"),
  ]);

  const productById = new Map(products.map((row) => [row.id, row]));
  const branchById = new Map(branches.map((row) => [row.id, row]));
  const lotsByPair = new Map();

  for (const lot of lots) {
    const key = pairKey(lot);
    const current = lotsByPair.get(key) ?? [];
    current.push(lot);
    lotsByPair.set(key, current);
  }

  const drifts = branchStock
    .map((stock) => {
      const pairLots = lotsByPair.get(pairKey(stock)) ?? [];
      const sumByStatus = Object.fromEntries(
        ["active", "expired", "consumed", "disposed", "cancelled"].map(
          (status) => [
            status,
            pairLots
              .filter((lot) => lot.status === status)
              .reduce((sum, lot) => sum + number(lot.current_qty), 0),
          ],
        ),
      );
      const branchQty = number(stock.quantity);
      const activeQty = number(sumByStatus.active);
      const physicalLotQty = activeQty + number(sumByStatus.expired);
      return {
        branchId: stock.branch_id,
        branch: branchById.get(stock.branch_id)?.name ?? stock.branch_id,
        productId: stock.product_id,
        code: productById.get(stock.product_id)?.code ?? stock.product_id,
        product: productById.get(stock.product_id)?.name ?? "",
        unit: productById.get(stock.product_id)?.unit ?? "",
        branchQty,
        activeQty,
        expiredQty: number(sumByStatus.expired),
        physicalLotQty,
        activeOnlyDrift: branchQty - activeQty,
        physicalLotDrift: branchQty - physicalLotQty,
        activeLotCount: pairLots.filter((lot) => lot.status === "active").length,
        expiredLotCount: pairLots.filter((lot) => lot.status === "expired").length,
        openingLotQty: pairLots
          .filter(
            (lot) =>
              lot.source_type === "opening" &&
              (lot.status === "active" || lot.status === "expired"),
          )
          .reduce((sum, lot) => sum + number(lot.current_qty), 0),
      };
    })
    .filter((row) => Math.abs(row.activeOnlyDrift) > 0.01)
    .sort(
      (left, right) =>
        Math.abs(right.activeOnlyDrift) - Math.abs(left.activeOnlyDrift),
    );

  const summary = {
    checkedAt: new Date().toISOString(),
    tenantId,
    mode: "SELECT_ONLY",
    activeOnlyDriftCount: drifts.length,
    truePhysicalLotDriftCount: drifts.filter(
      (row) => Math.abs(row.physicalLotDrift) > 0.01,
    ).length,
    expiredStatusOnlyCount: drifts.filter(
      (row) =>
        Math.abs(row.physicalLotDrift) <= 0.01 && row.expiredQty !== 0,
    ).length,
  };

  console.log(JSON.stringify({ summary, drifts }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
