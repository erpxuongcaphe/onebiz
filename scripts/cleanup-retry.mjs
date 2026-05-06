#!/usr/bin/env node
/**
 * Cleanup retry — fix các table mà script đầu chưa xoá được.
 * Lý do fail lần đầu: FK column names sai + thứ tự dependency.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function loadEnv(path) {
  if (!existsSync(path)) return;
  const c = readFileSync(path, "utf8");
  for (const line of c.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const e = t.indexOf("=");
    if (e < 0) continue;
    const k = t.substring(0, e).trim();
    let v = t.substring(e + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.substring(1, v.length - 1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env.local");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const TENANT_ID = "148e8ac5-b891-4de3-9055-cfa41f39ddb0";
const ADMIN_USER_ID = "7f763419-5392-49de-9796-af2402c8cd23";
const KEEP_BRANCH_ID = "558adc8f-a629-4ae6-90a6-d13c2a83896c";

async function step(name, fn) {
  process.stdout.write(`  ${name.padEnd(50)}`);
  try {
    const r = await fn();
    console.log(`✅ ${r ?? ""}`);
  } catch (e) {
    console.log(`⚠️  ${e.message?.substring(0, 80)}`);
  }
}

async function getIds(table, scope = "tenant_id") {
  const { data } = await sb
    .from(table)
    .select("id")
    .eq(scope, scope === "tenant_id" ? TENANT_ID : TENANT_ID);
  return (data ?? []).map((r) => r.id);
}

async function deleteIn(table, fkCol, ids) {
  if (ids.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { error, count } = await sb
      .from(table)
      .delete({ count: "exact" })
      .in(fkCol, chunk);
    if (error) throw error;
    deleted += count ?? 0;
  }
  return deleted;
}

async function main() {
  console.log("🔥 CLEANUP RETRY — fix FK chains còn lại\n");

  // 1. Purchase order items (column thực: purchase_order_id)
  await step("purchase_order_items via purchase_orders", async () => {
    const ids = await getIds("purchase_orders");
    const n = await deleteIn("purchase_order_items", "purchase_order_id", ids);
    return `${n} rows`;
  });

  // 2. Purchase orders
  await step("purchase_orders", async () => {
    const { error, count } = await sb
      .from("purchase_orders")
      .delete({ count: "exact" })
      .eq("tenant_id", TENANT_ID);
    if (error) throw error;
    return `${count ?? 0} rows`;
  });

  // 3. Input invoices
  await step("input_invoices", async () => {
    const { error, count } = await sb
      .from("input_invoices")
      .delete({ count: "exact" })
      .eq("tenant_id", TENANT_ID);
    if (error) throw error;
    return `${count ?? 0} rows`;
  });

  // 4. Price tier items (column thực: price_tier_id)
  await step("price_tier_items via price_tiers", async () => {
    const { data: tiers } = await sb
      .from("price_tiers")
      .select("id")
      .eq("tenant_id", TENANT_ID);
    const ids = (tiers ?? []).map((r) => r.id);
    const n = await deleteIn("price_tier_items", "price_tier_id", ids);
    return `${n} rows`;
  });

  // 5. Products (sau khi tất cả refs đã xoá)
  await step("products", async () => {
    const { error, count } = await sb
      .from("products")
      .delete({ count: "exact" })
      .eq("tenant_id", TENANT_ID);
    if (error) throw error;
    return `${count ?? 0} rows`;
  });

  // 6. Suppliers
  await step("suppliers", async () => {
    const { error, count } = await sb
      .from("suppliers")
      .delete({ count: "exact" })
      .eq("tenant_id", TENANT_ID);
    if (error) throw error;
    return `${count ?? 0} rows`;
  });

  // 7. Branches non-keep
  await step("branches (non Kho Tổng)", async () => {
    const { error, count } = await sb
      .from("branches")
      .delete({ count: "exact" })
      .eq("tenant_id", TENANT_ID)
      .neq("id", KEEP_BRANCH_ID);
    if (error) throw error;
    return `${count ?? 0} rows`;
  });

  // 8. Verify
  console.log("\n✅ VERIFY:");
  for (const t of [
    "profiles",
    "branches",
    "products",
    "invoices",
    "customers",
    "suppliers",
    "purchase_orders",
    "input_invoices",
    "categories",
    "price_tiers",
  ]) {
    const { count } = await sb
      .from(t)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID);
    console.log(`  ${t.padEnd(25)} ${String(count ?? 0).padStart(6)} rows`);
  }
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
