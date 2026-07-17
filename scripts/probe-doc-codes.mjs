#!/usr/bin/env node
/**
 * READ-ONLY — với từng reference_type CHƯA có mã thật (Thẻ kho Đợt 3), lấy 1
 * reference_id mẫu rồi dò xem nó nằm ở bảng nào + bảng đó có cột `code` không.
 * Mục tiêu: xác minh resolver batch-load đúng bảng/cột, KHÔNG chế mã.
 *   node scripts/probe-doc-codes.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
function loadEnv(p){ if(!existsSync(p))return; for(const l of readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const e=t.indexOf("=");if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;} }
loadEnv(join(process.cwd(),".env.local")); loadEnv(join(process.cwd(),".env"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const TENANT = "148e8ac5-b891-4de3-9055-cfa41f39ddb0";

// Các loại CẦN mã thật nhưng resolver hiện chưa lấy
const NEED = ["production_order","inventory_check","disposal_export","sales_return","return_bom_restore","purchase_order_revert","invoice_void","stock_transfer","internal_export"];
// Bảng ứng viên để dò reference_id
const CANDIDATES = ["production_orders","inventory_checks","disposals","disposal_exports","sales_returns","purchase_returns","supplier_returns","stock_transfers","purchase_orders","invoices","internal_exports","returns"];

async function tableHasId(tbl, id){
  try {
    const { data, error } = await db.from(tbl).select("id, code").eq("id", id).maybeSingle();
    if (error) return { ok:false, err: error.message.slice(0,60) };
    if (!data) return { ok:false, err:"(không thấy id)" };
    return { ok:true, code: data.code ?? "(bảng có nhưng cột code NULL/không có)" };
  } catch(e){ return { ok:false, err:(e.message||"").slice(0,60) }; }
}

async function main(){
  // Đếm phân bố + lấy 1 mẫu reference_id cho từng loại
  for (const rt of NEED){
    const { data } = await db.from("stock_movements")
      .select("id, reference_id, note")
      .eq("tenant_id", TENANT).eq("reference_type", rt)
      .not("reference_id","is",null)
      .limit(1);
    const { count } = await db.from("stock_movements")
      .select("id",{count:"exact",head:true})
      .eq("tenant_id", TENANT).eq("reference_type", rt);
    const sample = data?.[0];
    console.log(`\n━━ ${rt}  (tổng ${count ?? 0} dòng) ━━`);
    if (!sample){ console.log("  (không có dòng nào có reference_id)"); continue; }
    console.log(`  reference_id mẫu: ${sample.reference_id}`);
    console.log(`  note mẫu: ${(sample.note||"").slice(0,70)}`);
    let found = false;
    for (const tbl of CANDIDATES){
      const r = await tableHasId(tbl, sample.reference_id);
      if (r.ok){ console.log(`  → KHỚP bảng "${tbl}", code = ${r.code}`); found = true; }
    }
    if (!found) console.log("  → KHÔNG khớp bảng ứng viên nào (reference_id trỏ đâu?)");
  }
  console.log("\nXONG — read-only.");
}
main().catch(e=>{console.error(e.message||e);process.exit(1);});
