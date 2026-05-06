#!/usr/bin/env node
/**
 * Database Restore Script — counterpart của backup-db.mjs.
 *
 * Đọc thư mục backup → restore từng table qua INSERT.
 *
 * SỬ DỤNG:
 *   node scripts/restore-db.mjs <backup_dir>
 *
 * VÍ DỤ:
 *   node scripts/restore-db.mjs backups/2026-05-06_14-30-00
 *
 * ⚠️ DESTRUCTIVE: nếu data hiện tại có conflict (UUID trùng) → INSERT
 *    sẽ fail. Tùy theo nhu cầu, anh có thể:
 *    1. Chạy DELETE FROM table; trước (full replace)
 *    2. Hoặc dùng UPSERT (em chọn option này — onConflict = 'id')
 *
 * KHUYẾN CÁO: chỉ restore khi cleanup script vừa chạy xong và phát hiện
 * sai. Nếu Supabase đã có data mới (sau cleanup), restore sẽ MERGE
 * data cũ + mới có thể gây inconsistent.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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
loadEnv(".env");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Thiếu env: SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const backupDir = process.argv[2];
if (!backupDir) {
  console.error("Usage: node scripts/restore-db.mjs <backup_dir>");
  console.error("Ví dụ: node scripts/restore-db.mjs backups/2026-05-06_14-30-00");
  process.exit(1);
}

if (!existsSync(backupDir)) {
  console.error(`❌ Thư mục không tồn tại: ${backupDir}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Order quan trọng: parent tables trước (FK constraint)
const RESTORE_ORDER = [
  "tenants",
  "branches",
  "profiles",
  "roles",
  "role_permissions",
  "user_branches",
  "categories",
  "products",
  "product_variants",
  "customers",
  "suppliers",
  "delivery_partners",
  "code_sequences",
  "price_tiers",
  "price_tier_items",
  "promotions",
  "promotion_settings",
  "coupons",
  "boms",
  "bom_items",
  "purchase_orders",
  "po_items",
  "supplier_returns",
  "supplier_return_items",
  "input_invoices",
  "invoices",
  "invoice_items",
  "sales_orders",
  "sales_order_items",
  "sales_returns",
  "return_items",
  "shipping_orders",
  "tables",
  "kitchen_orders",
  "kitchen_order_items",
  "shifts",
  "inventory_checks",
  "inventory_check_items",
  "disposal_exports",
  "disposal_export_items",
  "internal_exports",
  "internal_export_items",
  "internal_sales",
  "internal_sale_items",
  "stock_transfers",
  "stock_transfer_items",
  "production_orders",
  "production_materials",
  "product_lots",
  "stock_movements",
  "branch_stock",
  "branch_inventory",
  "cash_transactions",
  "coupon_usages",
  "loyalty_transactions",
  "online_orders",
  "agents",
  "agent_tasks",
  "agent_executions",
  "kpi_breakdowns",
  "favorites",
  "conversations",
  "messages",
  "notifications",
  "audit_log",
];

async function restoreTable(table) {
  const filePath = join(backupDir, `${table}.json`);
  if (!existsSync(filePath)) {
    console.warn(`  ⚠️  ${table}: file không tồn tại — skip`);
    return { table, count: 0, skipped: true };
  }

  try {
    const content = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content);
    const rows = parsed.rows ?? [];

    if (rows.length === 0) {
      console.log(`  ⏭️  ${table.padEnd(30)} 0 rows (skip)`);
      return { table, count: 0, skipped: true };
    }

    // Batch insert 100 rows/lần để tránh payload quá lớn
    let inserted = 0;
    const chunkSize = 100;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase
        .from(table)
        .upsert(chunk, { onConflict: "id" });
      if (error) {
        console.warn(`  ⚠️  ${table}: chunk ${i / chunkSize}: ${error.message}`);
        continue;
      }
      inserted += chunk.length;
    }

    console.log(`  ✅ ${table.padEnd(30)} ${String(inserted).padStart(6)}/${String(rows.length).padStart(6)} rows`);
    return { table, count: inserted, skipped: false };
  } catch (err) {
    console.warn(`  ❌ ${table}: ${err.message}`);
    return { table, count: 0, skipped: true };
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(`🔄 Database Restore từ ${backupDir}`);
  console.log("═══════════════════════════════════════════════════════");

  const startTime = Date.now();
  let totalRows = 0;

  for (const table of RESTORE_ORDER) {
    const r = await restoreTable(table);
    totalRows += r.count;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("═══════════════════════════════════════════════════════");
  console.log(`✅ Restore hoàn tất — ${elapsed}s`);
  console.log(`   ${totalRows.toLocaleString()} rows restored`);
  console.log("═══════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("❌ Restore thất bại:", err);
  process.exit(1);
});
