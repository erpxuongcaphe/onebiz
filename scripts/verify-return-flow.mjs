#!/usr/bin/env node
/**
 * Verify luồng TRẢ HÀNG (BATCH 3R) — CHỈ ĐỌC, KHÔNG GHI GÌ.
 *
 * Hệ thống đang chạy thật → script này TUYỆT ĐỐI không đổi data:
 *   - Chỉ dùng SELECT + RPC `get_active_bom_for_branch` (STABLE = pure read).
 *   - 2 probe kiểm tra RPC tồn tại được thiết kế KHÔNG ghi:
 *       · restore_bom_for_return(null,...) → raise ngay ở guard, trước mọi DML.
 *       · increment_returned_qty(<uuid rác>, 0) → UPDATE khớp 0 dòng, delta 0.
 *
 * 5 lớp kiểm tra:
 *   A. Schema: invoice_items.returned_qty đã có chưa.
 *   B. RPC tồn tại: restore_bom_for_return + increment_returned_qty.
 *   C. Shadow-simulation: lấy SKU has_bom thật → tính NVL sẽ hồi (đúng công
 *      thức RPC) mà KHÔNG chạy RPC ghi.
 *   D. Audit lịch sử: phiếu trả cũ của SKU has_bom có bị cộng tồn ảo SKU không
 *      (dấu vết bug cũ) + NVL có bị thiếu hồi không.
 *   E. Badge: chạy đúng aggregate getInvoices dùng → in HĐ + badge suy ra.
 *
 *   node scripts/verify-return-flow.mjs
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
if (!URL || !KEY) {
  console.error("❌ Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local");
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);
const info = (m) => console.log(`  ·  ${m}`);
const hr = (t) => console.log(`\n━━━ ${t} ━━━`);

const fmt = (n) => new Intl.NumberFormat("vi-VN").format(Math.round((n ?? 0) * 100) / 100);

async function main() {
  console.log("VERIFY LUỒNG TRẢ HÀNG (BATCH 3R) — READ-ONLY, KHÔNG GHI DATA");
  console.log("DB:", URL);

  // ── A. Schema: invoice_items.returned_qty ───────────────────────────────
  hr("A. Schema invoice_items.returned_qty");
  {
    const { data, error } = await db
      .from("invoice_items")
      .select("id, returned_qty")
      .limit(1);
    if (error) {
      if (/returned_qty/.test(error.message)) bad(`Cột returned_qty CHƯA có: ${error.message}`);
      else bad(`Lỗi đọc invoice_items: ${error.message}`);
    } else {
      ok("Cột returned_qty đã tồn tại (đọc được).");
      // Phân bố: bao nhiêu dòng đã trả 1 phần
      const { count: total } = await db
        .from("invoice_items")
        .select("id", { count: "exact", head: true });
      const { count: withReturn } = await db
        .from("invoice_items")
        .select("id", { count: "exact", head: true })
        .gt("returned_qty", 0);
      info(`Tổng invoice_items: ${fmt(total)} — đã có returned_qty>0: ${fmt(withReturn)} dòng.`);
    }
  }

  // ── B. RPC tồn tại (probe KHÔNG ghi) ────────────────────────────────────
  hr("B. RPC restore_bom_for_return + increment_returned_qty");
  {
    // restore_bom_for_return: null tenant → guard raise trước mọi DML.
    const { error } = await db.rpc("restore_bom_for_return", {
      p_tenant_id: null,
      p_branch_id: null,
      p_sku_id: null,
      p_qty: 1,
      p_reference_id: null,
      p_created_by: null,
      p_ref_code: null,
    });
    if (!error) {
      info("restore_bom_for_return: gọi null KHÔNG báo lỗi (bất thường, nhưng guard đáng lẽ raise).");
    } else if (error.code === "PGRST202" || /could not find|does not exist/i.test(error.message)) {
      bad(`restore_bom_for_return CHƯA tồn tại trên DB: ${error.message}`);
    } else if (/required|tenant_id/i.test(error.message)) {
      ok(`restore_bom_for_return tồn tại (guard raise đúng): "${error.message.split("\n")[0]}"`);
    } else {
      info(`restore_bom_for_return tồn tại — lỗi khác: ${error.message.split("\n")[0]}`);
    }
  }
  {
    // increment_returned_qty: uuid rác + delta 0 → UPDATE 0 dòng, không đổi data.
    const { error } = await db.rpc("increment_returned_qty", {
      p_invoice_item_id: "00000000-0000-0000-0000-000000000000",
      p_delta: 0,
    });
    if (!error) ok("increment_returned_qty tồn tại (probe uuid rác + delta 0 → 0 dòng, không ghi).");
    else if (error.code === "PGRST202" || /could not find|does not exist/i.test(error.message))
      bad(`increment_returned_qty CHƯA tồn tại: ${error.message}`);
    else info(`increment_returned_qty — lỗi: ${error.message.split("\n")[0]}`);
  }

  // Chọn tenant THẬT: tenant có nhiều BOM nhất (production = 602 BOM, các
  // tenant test = 0). Cho phép override qua argv[2] nếu cần.
  let tenantId = process.argv[2];
  if (!tenantId) {
    const { data: tenants } = await db.from("tenants").select("id, name").limit(50);
    let best = null, bestBom = -1;
    for (const t of tenants ?? []) {
      const { count } = await db
        .from("bom")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", t.id);
      if ((count ?? 0) > bestBom) { bestBom = count ?? 0; best = t; }
    }
    tenantId = best?.id;
    info(`Tenant chọn để kiểm tra: ${best?.name} [${tenantId}] — ${fmt(bestBom)} BOM.`);
  }
  if (!tenantId) {
    info("Không tìm thấy tenant nào → bỏ qua C/D/E.");
    return;
  }
  const { data: branches } = await db
    .from("branches")
    .select("id, name")
    .eq("tenant_id", tenantId);

  // ── C. Shadow-simulation hồi NVL ────────────────────────────────────────
  hr("C. Mô phỏng hồi NVL cho 1 SKU has_bom (KHÔNG chạy RPC ghi)");
  {
    const { data: skus } = await db
      .from("products")
      .select("id, name, code, has_bom, bom_code")
      .eq("tenant_id", tenantId)
      .eq("has_bom", true)
      .limit(50);
    if (!skus?.length) {
      info("Tenant này không có SKU has_bom → bỏ qua mô phỏng.");
    } else {
      const WANT = 4; // số ví dụ đa dạng muốn show
      let shown = 0;
      for (const sku of skus) {
        if (shown >= WANT) break;
        for (const br of branches ?? [{ id: null, name: "(global)" }]) {
          // get_active_bom_for_branch là STABLE → gọi an toàn, không ghi.
          const { data: bomId, error } = await db.rpc("get_active_bom_for_branch", {
            p_product_id: sku.id,
            p_branch_id: br.id,
          });
          if (error || !bomId) continue;
          const { data: items } = await db
            .from("bom_items")
            .select("material_id, quantity, waste_percent, products:material_id(name, unit)")
            .eq("bom_id", bomId)
            .order("sort_order");
          if (!items?.length) continue;

          const refundQty = 1;
          console.log(`  ── Ví dụ ${shown + 1}: ${sku.name} (${sku.code}) @ ${br.name}`);
          info(`Trả ${refundQty} đơn vị → hồi NVL (qty × (1+waste%) × ${refundQty}):`);
          let any = false, selfBom = false;
          for (const it of items) {
            if (it.material_id === sku.id) {
              console.log(`     ⊘ bỏ qua self-BOM (material trùng chính SKU): ${it.products?.name}`);
              selfBom = true;
              continue;
            }
            const restore = Math.round(it.quantity * (1 + (it.waste_percent ?? 0) / 100) * refundQty * 10000) / 10000;
            if (restore <= 0) continue;
            any = true;
            const w = it.waste_percent ? ` (waste ${it.waste_percent}%)` : "";
            console.log(`     + ${fmt(restore)} ${it.products?.unit ?? ""} — ${it.products?.name ?? it.material_id}${w}`);
          }
          if (any || selfBom) shown++;
          break;
        }
      }
      if (shown > 0) ok(`Mô phỏng ${shown} SKU khớp logic RPC (dấu DƯƠNG, áp waste, skip self-BOM).`);
      else info("Không tìm thấy SKU has_bom nào có BOM active để mô phỏng.");
    }
  }

  // ── D. Audit lịch sử: dấu vết bug cũ ────────────────────────────────────
  hr("D. Audit phiếu trả CŨ của SKU has_bom (phát hiện tồn ảo bug trước đây)");
  {
    const { data: rets } = await db
      .from("sales_returns")
      .select("id, code, status")
      .eq("tenant_id", tenantId)
      .eq("status", "completed")
      .limit(500);
    if (!rets?.length) {
      info("Chưa có phiếu trả hàng completed nào → không có lịch sử để audit (sạch).");
    } else {
      info(`Tổng phiếu trả completed: ${rets.length}`);
      const retIds = rets.map((r) => r.id);
      // return_items + has_bom của SKU
      const { data: ri } = await db
        .from("return_items")
        .select("return_id, product_id, product_name, quantity, products:product_id(has_bom)")
        .in("return_id", retIds);
      const bomReturnItems = (ri ?? []).filter((x) => x.products?.has_bom);
      info(`Dòng trả thuộc SKU has_bom: ${bomReturnItems.length}`);
      if (bomReturnItems.length) {
        // Dấu vết bug cũ: stock_movements type='in', reference_type='sales_return',
        // product_id = chính SKU has_bom (đáng lẽ KHÔNG được cộng tồn SKU).
        const bomSkuIds = [...new Set(bomReturnItems.map((x) => x.product_id))];
        const { data: sm } = await db
          .from("stock_movements")
          .select("product_id, quantity, reference_id, note")
          .eq("tenant_id", tenantId)
          .eq("reference_type", "sales_return")
          .eq("type", "in")
          .in("reference_id", retIds)
          .in("product_id", bomSkuIds);
        if (sm?.length) {
          bad(`Phát hiện ${sm.length} stock_movement cộng tồn ẢO vào SKU has_bom (bug CŨ trước 00144).`);
          info("→ Đây là tồn ảo lịch sử. Cần quyết định có viết migration dọn không (em sẽ đề xuất).");
          for (const m of sm.slice(0, 5)) {
            const nm = bomReturnItems.find((x) => x.product_id === m.product_id)?.product_name;
            console.log(`     • +${fmt(m.quantity)} vào "${nm ?? m.product_id}" (ref ${m.reference_id})`);
          }
          if (sm.length > 5) info(`     … và ${sm.length - 5} dòng nữa.`);
        } else {
          ok("KHÔNG có stock_movement cộng tồn ảo vào SKU has_bom → lịch sử sạch (chưa từng trả SKU BOM).");
        }
        // NVL có từng được hồi chưa (reference_type='return_bom_restore')?
        const { count: restoreCnt } = await db
          .from("stock_movements")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("reference_type", "return_bom_restore");
        info(`stock_movements 'return_bom_restore' (hồi NVL kiểu mới): ${fmt(restoreCnt)} dòng.`);
      }
    }
  }

  // ── E. Badge aggregate (đúng query getInvoices) ─────────────────────────
  hr("E. Badge 'Đã trả 1 phần'/'toàn bộ' — chạy đúng aggregate của getInvoices");
  {
    const { data: invs } = await db
      .from("invoices")
      .select("id, code, total")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(50);
    const ids = (invs ?? []).map((i) => i.id);
    const { data: retRows } = await db
      .from("sales_returns")
      .select("invoice_id, total")
      .eq("tenant_id", tenantId)
      .eq("status", "completed")
      .in("invoice_id", ids);
    const map = new Map();
    for (const r of retRows ?? []) {
      if (!r.invoice_id) continue;
      map.set(r.invoice_id, (map.get(r.invoice_id) ?? 0) + Number(r.total ?? 0));
    }
    const withBadge = (invs ?? [])
      .map((i) => ({ ...i, returned: map.get(i.id) ?? 0 }))
      .filter((i) => i.returned > 0);
    if (!withBadge.length) {
      info("50 HĐ gần nhất chưa có HĐ nào có phiếu trả → chưa badge nào hiện (đúng).");
    } else {
      ok(`${withBadge.length} HĐ trong 50 gần nhất sẽ hiện badge:`);
      for (const i of withBadge) {
        const badge = i.returned >= i.total ? "Đã trả toàn bộ 🔴" : "Đã trả 1 phần 🟡";
        console.log(`     ${i.code}: trả ${fmt(i.returned)} / tổng ${fmt(i.total)} → ${badge}`);
      }
    }
  }

  console.log("\n✔ Hoàn tất — KHÔNG có thao tác ghi nào được thực hiện.");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
