#!/usr/bin/env node
/**
 * Database Backup Script — Sprint CLEANUP (CEO 06/05/2026).
 *
 * Supabase Free plan KHÔNG có managed backup. Script này dùng
 * service_role key (đã có trong .env) để dump tất cả tables → JSON files
 * lưu local trên máy CEO.
 *
 * SỬ DỤNG:
 *   1. Đảm bảo file .env.local có SUPABASE_SERVICE_ROLE_KEY +
 *      NEXT_PUBLIC_SUPABASE_URL
 *   2. node scripts/backup-db.mjs
 *   3. Output: backups/2026-05-06_HH-mm-ss/{table}.json
 *   4. Mỗi file JSON là array rows, có thể inspect / restore qua
 *      restore-db.mjs (nếu viết)
 *
 * RESTORE (manual):
 *   - Chạy SQL DELETE FROM target_table; INSERT lại từ JSON
 *   - Hoặc viết restore-db.mjs lookup file và bulk insert
 *
 * ⚠️ KHÔNG commit file backup lên git (có sample data).
 *    Em đã add backups/ vào .gitignore.
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Load env từ .env.local hoặc .env (manual parse — không cần dotenv package)
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
    // Strip surrounding quotes
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
  console.error(
    "❌ Thiếu env: NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY",
  );
  console.error(
    "   → Kiểm tra file .env.local trong project root đã có chưa.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Danh sách tables cần backup (theo migration files 00001-00050)
// Order: master data → transactions → metadata
const TABLES = [
  // Master data
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

  // Pricing
  "price_tiers",
  "price_tier_items",

  // Promotions
  "promotions",
  "promotion_settings",
  "coupons",
  "coupon_usages",

  // Sales
  "invoices",
  "invoice_items",
  "sales_orders",
  "sales_order_items",
  "sales_returns",
  "return_items",
  "shipping_orders",

  // Purchases
  "purchase_orders",
  "po_items",
  "supplier_returns",
  "supplier_return_items",
  "input_invoices",

  // Inventory
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
  "stock_movements",
  "branch_stock",
  "branch_inventory",

  // Production
  "boms",
  "bom_items",
  "production_orders",
  "production_materials",
  "product_lots",

  // F&B
  "tables",
  "kitchen_orders",
  "kitchen_order_items",
  "shifts",

  // Cash & finance
  "cash_transactions",
  "loyalty_transactions",

  // Online
  "online_orders",

  // AI Agents
  "agents",
  "agent_tasks",
  "agent_executions",
  "kpi_breakdowns",

  // Misc
  "favorites",
  "conversations",
  "messages",
  "notifications",
  "audit_log",
];

async function backupTable(table, outDir) {
  try {
    const { data, error, count } = await supabase
      .from(table)
      .select("*", { count: "exact" });

    if (error) {
      // Bảng không tồn tại / RLS chặn — skip với cảnh báo
      console.warn(`  ⚠️  ${table}: ${error.message}`);
      return { table, count: 0, skipped: true };
    }

    const rows = data ?? [];
    const filePath = join(outDir, `${table}.json`);
    writeFileSync(
      filePath,
      JSON.stringify({ table, count: rows.length, rows }, null, 2),
      "utf8",
    );
    console.log(`  ✅ ${table.padEnd(30)} ${String(rows.length).padStart(6)} rows`);
    return { table, count: rows.length, skipped: false };
  } catch (err) {
    console.warn(`  ⚠️  ${table}: ${err.message}`);
    return { table, count: 0, skipped: true };
  }
}

async function main() {
  // Tạo thư mục backups/{timestamp}/
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .substring(0, 19);
  const outDir = join("backups", stamp);

  if (!existsSync("backups")) mkdirSync("backups");
  mkdirSync(outDir, { recursive: true });

  console.log("═══════════════════════════════════════════════════════");
  console.log(`📦 Database Backup — ${stamp}`);
  console.log(`   Output: ${outDir}/`);
  console.log("═══════════════════════════════════════════════════════");

  const startTime = Date.now();
  const results = [];
  let totalRows = 0;
  let skippedTables = 0;

  for (const table of TABLES) {
    const r = await backupTable(table, outDir);
    results.push(r);
    if (r.skipped) skippedTables++;
    else totalRows += r.count;
  }

  // Manifest file
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const manifest = {
    timestamp: new Date().toISOString(),
    supabaseUrl: SUPABASE_URL,
    elapsedSec: elapsed,
    totalTables: TABLES.length,
    successTables: TABLES.length - skippedTables,
    skippedTables,
    totalRows,
    tables: results,
  };
  writeFileSync(
    join(outDir, "_manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  console.log("═══════════════════════════════════════════════════════");
  console.log(`✅ Backup hoàn tất — ${elapsed}s`);
  console.log(`   ${TABLES.length - skippedTables}/${TABLES.length} tables OK`);
  console.log(`   ${totalRows.toLocaleString()} rows tổng cộng`);
  console.log(`   File: ${outDir}/`);
  if (skippedTables > 0) {
    console.log(
      `   ⚠️  ${skippedTables} tables skipped (xem warning ở trên)`,
    );
  }
  console.log("═══════════════════════════════════════════════════════");
  console.log("");
  console.log("📋 BƯỚC KẾ TIẾP:");
  console.log("   1. Verify file backups/ có đầy đủ data");
  console.log("   2. Copy thư mục backups/ sang nơi an toàn (USB / Google Drive)");
  console.log("   3. Chạy cleanup script trên Supabase Dashboard:");
  console.log("      supabase/cleanup_sample_data.sql");
  console.log("");
}

main().catch((err) => {
  console.error("❌ Backup thất bại:", err);
  process.exit(1);
});
