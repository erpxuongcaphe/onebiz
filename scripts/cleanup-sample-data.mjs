#!/usr/bin/env node
/**
 * Cleanup sample data — Sprint CLEANUP (CEO 06/05/2026).
 *
 * Node.js version của supabase/cleanup_sample_data.sql (vì em không truy
 * cập Supabase Dashboard được — dùng service_role key qua SDK thay thế).
 *
 * GIỮ LẠI:
 *   - admin@xuongcaphe.com (user)
 *   - Tenant của admin (148e8ac5-...)
 *   - 1 chi nhánh "Kho Tổng" (warehouse, 558adc8f-...)
 *   - Roles + role_permissions
 *
 * XOÁ:
 *   - Tất cả branch khác (Xưởng Rang, 3 quán)
 *   - Tất cả master data (products, customers, suppliers, ...)
 *   - Tất cả transactions (invoices, orders, inventory_checks, ...)
 *
 * SỬ DỤNG:
 *   node scripts/cleanup-sample-data.mjs           # dry-run (preview only)
 *   node scripts/cleanup-sample-data.mjs --execute # thực sự xoá
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function loadEnv(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.substring(0, eq).trim();
    let value = trimmed.substring(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.substring(1, value.length - 1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv(".env.local");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Thiếu SUPABASE_SERVICE_ROLE_KEY trong .env.local");
  process.exit(1);
}

const DRY_RUN = !process.argv.includes("--execute");
const ADMIN_EMAIL = "admin@xuongcaphe.com";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Tables xoá scope by tenant_id, order: child trước, parent sau (FK)
// Nếu tenant column tên khác hoặc table không có tenant_id → custom delete
const TABLES_TO_DELETE = [
  // Audit + notifications + conversations
  { name: "audit_log", scope: "tenant_id" },
  { name: "notifications", scope: "tenant_id" },
  { name: "conversations", scope: "tenant_id" },

  // AI agents
  { name: "agent_executions", scope: "tenant_id" },
  { name: "agent_tasks", scope: "tenant_id" },
  { name: "kpi_breakdowns", scope: "tenant_id" },
  { name: "agents", scope: "tenant_id" },

  // Online
  { name: "online_orders", scope: "tenant_id" },

  // Loyalty
  { name: "loyalty_transactions", scope: "tenant_id" },

  // Cash
  { name: "cash_transactions", scope: "tenant_id" },

  // F&B
  { name: "kitchen_order_items", scope: "via_kitchen_orders" },
  { name: "kitchen_orders", scope: "tenant_id" },
  { name: "shifts", scope: "tenant_id" },

  // Sales
  { name: "invoice_items", scope: "via_invoices" },
  { name: "invoices", scope: "tenant_id" },
  { name: "sales_order_items", scope: "via_sales_orders" },
  { name: "sales_orders", scope: "tenant_id" },
  { name: "return_items", scope: "via_sales_returns" },
  { name: "sales_returns", scope: "tenant_id" },
  { name: "shipping_orders", scope: "tenant_id" },

  // Purchases
  { name: "purchase_order_items", scope: "via_purchase_orders" },
  { name: "purchase_orders", scope: "tenant_id" },
  { name: "supplier_return_items", scope: "via_supplier_returns" },
  { name: "supplier_returns", scope: "tenant_id" },
  { name: "input_invoices", scope: "tenant_id" },

  // Inventory
  { name: "inventory_check_items", scope: "via_inventory_checks" },
  { name: "inventory_checks", scope: "tenant_id" },
  { name: "disposal_export_items", scope: "via_disposal_exports" },
  { name: "disposal_exports", scope: "tenant_id" },
  { name: "internal_export_items", scope: "via_internal_exports" },
  { name: "internal_exports", scope: "tenant_id" },
  { name: "internal_sale_items", scope: "via_internal_sales" },
  { name: "internal_sales", scope: "tenant_id" },
  { name: "stock_transfer_items", scope: "via_stock_transfers" },
  { name: "stock_transfers", scope: "tenant_id" },
  { name: "stock_movements", scope: "tenant_id" },
  { name: "branch_stock", scope: "tenant_id" },

  // Production
  { name: "production_order_materials", scope: "via_production_orders" },
  { name: "production_orders", scope: "tenant_id" },
  { name: "product_lots", scope: "tenant_id" },
  { name: "bom_items", scope: "via_bom" },
  { name: "bom", scope: "tenant_id" },

  // Pricing & Promotions
  { name: "price_tier_items", scope: "via_price_tiers" },
  { name: "price_tiers", scope: "tenant_id" },
  { name: "coupon_usages", scope: "via_coupons" },
  { name: "coupons", scope: "tenant_id" },
  { name: "promotions", scope: "tenant_id" },

  // Master data
  { name: "product_variants", scope: "via_products" },
  { name: "products", scope: "tenant_id" },
  { name: "customers", scope: "tenant_id" },
  { name: "suppliers", scope: "tenant_id" },
  { name: "categories", scope: "tenant_id" },
  { name: "delivery_partners", scope: "tenant_id" },

  // F&B tables
  { name: "restaurant_tables", scope: "tenant_id" },

  // Favorites
  { name: "favorites", scope: "via_user" },
];

async function findAdminContext() {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, tenant_id, branch_id, email")
    .eq("email", ADMIN_EMAIL)
    .single();
  if (error || !profile) {
    throw new Error(`Không tìm thấy admin ${ADMIN_EMAIL}: ${error?.message}`);
  }

  // Tìm Kho Tổng để giữ
  const { data: warehouseBranch } = await supabase
    .from("branches")
    .select("id, name, branch_type")
    .eq("tenant_id", profile.tenant_id)
    .eq("branch_type", "warehouse")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  const keepBranchId = warehouseBranch?.id ?? profile.branch_id;
  if (!keepBranchId) {
    throw new Error("Không tìm thấy Kho Tổng để giữ lại");
  }

  return {
    userId: profile.id,
    tenantId: profile.tenant_id,
    keepBranchId,
    keepBranchName: warehouseBranch?.name ?? "Kho Tổng",
  };
}

async function countTable(table, scope, ctx) {
  try {
    let query = supabase.from(table).select("id", { count: "exact", head: true });
    if (scope === "tenant_id") {
      query = query.eq("tenant_id", ctx.tenantId);
    } else if (scope.startsWith("via_")) {
      // Skip via_X — đếm sau khi resolve parent IDs
      return null;
    } else if (scope === "via_user") {
      query = query.eq("user_id", ctx.userId);
    }
    const { count, error } = await query;
    if (error) return { count: 0, error: error.message };
    return { count: count ?? 0 };
  } catch (err) {
    return { count: 0, error: err.message };
  }
}

async function deleteTable(table, scope, ctx) {
  try {
    if (scope === "tenant_id") {
      const { error } = await supabase.from(table).delete().eq("tenant_id", ctx.tenantId);
      if (error) return { ok: false, message: error.message };
      return { ok: true };
    }
    if (scope === "via_user") {
      const { error } = await supabase.from(table).delete().eq("user_id", ctx.userId);
      if (error) return { ok: false, message: error.message };
      return { ok: true };
    }
    if (scope.startsWith("via_")) {
      // Resolve parent IDs first
      const parentTable = scope.substring(4);
      const fkColumn = `${parentTable.endsWith("s") ? parentTable.slice(0, -1) : parentTable}_id`;
      // Special case mappings
      const fkMap = {
        kitchen_orders: "kitchen_order_id",
        invoices: "invoice_id",
        sales_orders: "order_id",
        sales_returns: "return_id",
        purchase_orders: "po_id",
        supplier_returns: "return_id",
        inventory_checks: "check_id",
        disposal_exports: "disposal_id",
        internal_exports: "internal_export_id",
        internal_sales: "internal_sale_id",
        stock_transfers: "transfer_id",
        production_orders: "production_order_id",
        bom: "bom_id",
        price_tiers: "tier_id",
        coupons: "coupon_id",
        products: "product_id",
      };
      const actualFk = fkMap[parentTable] ?? fkColumn;

      const { data: parentIds } = await supabase
        .from(parentTable)
        .select("id")
        .eq("tenant_id", ctx.tenantId);
      if (!parentIds || parentIds.length === 0) return { ok: true, count: 0 };

      const ids = parentIds.map((r) => r.id);
      // Delete in chunks of 100
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { error } = await supabase.from(table).delete().in(actualFk, chunk);
        if (error) return { ok: false, message: error.message };
      }
      return { ok: true, count: ids.length };
    }
    return { ok: false, message: "Unknown scope" };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(
    DRY_RUN
      ? "🔍 CLEANUP SAMPLE DATA — DRY RUN (preview, không xoá)"
      : "🔥 CLEANUP SAMPLE DATA — EXECUTE (XOÁ THẬT, KHÔNG UNDO)",
  );
  console.log("═══════════════════════════════════════════════════════");

  const ctx = await findAdminContext();
  console.log(`\nAdmin: ${ADMIN_EMAIL}`);
  console.log(`  user_id: ${ctx.userId}`);
  console.log(`  tenant_id: ${ctx.tenantId}`);
  console.log(`  keep_branch: ${ctx.keepBranchName} (${ctx.keepBranchId})`);
  console.log("");

  // Bước 1: Count tables
  console.log("📊 Đếm số rows sẽ xoá...");
  let totalToDelete = 0;
  for (const t of TABLES_TO_DELETE) {
    if (t.scope === "tenant_id" || t.scope === "via_user") {
      const r = await countTable(t.name, t.scope, ctx);
      if (r && !r.error) {
        if (r.count > 0) {
          console.log(`  ${t.name.padEnd(34)} ${String(r.count).padStart(6)} rows`);
          totalToDelete += r.count;
        }
      } else if (r?.error) {
        console.log(`  ${t.name.padEnd(34)} ⚠️  ${r.error.substring(0, 40)}`);
      }
    }
  }

  // Count branches non-keep + non-admin profiles
  const { count: branchCount } = await supabase
    .from("branches")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .neq("id", ctx.keepBranchId);
  const { count: profileCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .neq("id", ctx.userId);

  console.log(`\n  branches (non Kho Tổng)            ${String(branchCount ?? 0).padStart(6)} rows`);
  console.log(`  profiles (non admin)               ${String(profileCount ?? 0).padStart(6)} rows`);
  totalToDelete += (branchCount ?? 0) + (profileCount ?? 0);

  console.log(`\n📌 Tổng: ${totalToDelete.toLocaleString()} rows sẽ bị xoá`);

  if (DRY_RUN) {
    console.log("\n✋ DRY RUN — không xoá gì cả.");
    console.log("   Chạy lại với --execute để xoá thật.");
    console.log("═══════════════════════════════════════════════════════");
    return;
  }

  // Bước 2: Delete loop
  console.log("\n🔥 BẮT ĐẦU XOÁ...\n");
  for (const t of TABLES_TO_DELETE) {
    const r = await deleteTable(t.name, t.scope, ctx);
    if (r.ok) {
      console.log(`  ✅ ${t.name}`);
    } else {
      console.log(`  ⚠️  ${t.name}: ${r.message?.substring(0, 60)}`);
    }
  }

  // Bước 3: Xoá branches non-keep
  console.log("\n🏢 Xoá chi nhánh không phải Kho Tổng...");
  const { error: bErr } = await supabase
    .from("branches")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .neq("id", ctx.keepBranchId);
  console.log(bErr ? `  ⚠️  ${bErr.message}` : "  ✅ branches");

  // Bước 4: Update Kho Tổng + admin profile
  console.log("\n🔧 Update Kho Tổng + admin profile...");
  await supabase
    .from("branches")
    .update({
      name: "Kho Tổng",
      branch_type: "warehouse",
      is_default: true,
    })
    .eq("id", ctx.keepBranchId);
  await supabase.from("profiles").update({ branch_id: ctx.keepBranchId }).eq("id", ctx.userId);
  console.log("  ✅ done");

  // Bước 5: Xoá users non-admin (TRỪ admin)
  console.log("\n👤 Xoá user không phải admin...");
  const { error: pErr } = await supabase
    .from("profiles")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .neq("id", ctx.userId);
  console.log(pErr ? `  ⚠️  ${pErr.message}` : "  ✅ profiles");

  // Bước 6: Reset code_sequences
  console.log("\n🔢 Reset code_sequences...");
  await supabase.from("code_sequences").update({ counter: 0 }).eq("tenant_id", ctx.tenantId);
  console.log("  ✅ done");

  // Bước 7: Verify
  console.log("\n✅ VERIFY KẾT QUẢ:");
  const tables = ["profiles", "branches", "products", "invoices", "customers", "suppliers"];
  for (const t of tables) {
    const { count } = await supabase
      .from(t)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId);
    console.log(`  ${t.padEnd(30)} ${String(count ?? 0).padStart(6)} rows`);
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("✅ CLEANUP HOÀN TẤT");
  console.log("═══════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("\n❌ Cleanup thất bại:", err);
  process.exit(1);
});
