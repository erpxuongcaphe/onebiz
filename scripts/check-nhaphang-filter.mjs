#!/usr/bin/env node
/**
 * READ-ONLY — kiểm chứng an toàn đổi filter picker Nhập hàng.
 * Hiện: .not("has_bom","is",true)  → NVL + mọi SKU CHƯA gắn BOM (leak SKU).
 * Đề xuất: .eq("product_type","nvl") → chỉ NVL.
 *
 * 3 câu hỏi:
 *  A. Hiện có bao nhiêu SKU đang LEAK vào picker nhập hàng (sku + has_bom≠true + active)?
 *  B. Có SP product_type='sku' nào TỪNG được mua (nằm trong input_invoice_items)?
 *     → nếu có, đổi sang nvl-only sẽ ẩn mất hàng anh mua thật.
 *  C. Có NVL nào has_bom=true (đang bị filter cũ ẩn nhầm, filter mới sẽ hiện lại)?
 *
 *   node scripts/check-nhaphang-filter.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.substring(0, eq).trim();
    let v = t.substring(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.substring(1, v.length - 1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(join(process.cwd(), ".env.local"));
loadEnv(join(process.cwd(), ".env"));

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("❌ Thiếu env"); process.exit(1); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  console.log("KIỂM TRA FILTER NHẬP HÀNG — READ-ONLY\nDB:", URL, "\n");

  // A. SKU đang leak (sku + has_bom≠true + active)
  const { data: leak, count: leakCount } = await db
    .from("products")
    .select("code, name, channel, has_bom", { count: "exact" })
    .eq("product_type", "sku")
    .eq("is_active", true)
    .or("has_bom.is.null,has_bom.eq.false");
  console.log(`A. SKU LEAK vào picker nhập hàng (sku + chưa BOM + active): ${leakCount ?? 0}`);
  (leak ?? []).slice(0, 12).forEach((p) =>
    console.log(`   · ${p.code}  ${p.name}  [channel=${p.channel ?? "null"}]`));
  if ((leakCount ?? 0) > 12) console.log(`   … và ${(leakCount ?? 0) - 12} SKU nữa`);

  // B. SP product_type='sku' từng được MUA (input_invoice_items)
  console.log("\nB. SP product_type='sku' TỪNG nằm trong phiếu nhập (input_invoice_items):");
  const { data: iiItems, error: iiErr } = await db
    .from("purchase_order_items")
    .select("product_id")
    .limit(50000);
  if (iiErr) {
    console.log(`   ⚠️ Không đọc được purchase_order_items: ${iiErr.message}`);
  } else {
    const ids = [...new Set((iiItems ?? []).map((r) => r.product_id).filter(Boolean))];
    console.log(`   · Tổng SP xuất hiện trong phiếu nhập: ${ids.length}`);
    // chấm điểm theo product_type
    const chunks = [];
    for (let i = 0; i < ids.length; i += 300) chunks.push(ids.slice(i, i + 300));
    const skuBought = [];
    for (const c of chunks) {
      const { data: ps } = await db
        .from("products")
        .select("id, code, name, product_type, has_bom")
        .in("id", c)
        .eq("product_type", "sku");
      (ps ?? []).forEach((p) => skuBought.push(p));
    }
    console.log(`   · Trong đó product_type='sku': ${skuBought.length}`);
    skuBought.slice(0, 20).forEach((p) =>
      console.log(`     ⚠️ ${p.code}  ${p.name}  [has_bom=${p.has_bom}]`));
    if (skuBought.length === 0)
      console.log("     ✅ 0 → an toàn: đổi sang product_type='nvl' KHÔNG ẩn hàng anh mua.");
  }

  // C. NVL có has_bom=true (filter cũ ẩn nhầm, filter mới hiện lại)
  const { data: nvlBom, count: nvlBomCount } = await db
    .from("products")
    .select("code, name", { count: "exact" })
    .eq("product_type", "nvl")
    .eq("is_active", true)
    .eq("has_bom", true);
  console.log(`\nC. NVL có has_bom=true (filter mới sẽ HIỆN lại trong nhập hàng): ${nvlBomCount ?? 0}`);
  (nvlBom ?? []).slice(0, 10).forEach((p) => console.log(`   · ${p.code}  ${p.name}`));

  console.log("\nXONG — không ghi gì.");
}
main().catch((e) => { console.error(e); process.exit(1); });
