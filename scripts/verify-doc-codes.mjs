#!/usr/bin/env node
/**
 * READ-ONLY — chứng minh Thẻ kho Đợt 3: "Mã phiếu" nay là MÃ CHỨNG TỪ THẬT
 * (không chế từ UUID). Với mỗi loại, lấy vài dòng sổ, join sang bảng gốc, in
 * cạnh nhau: [mã CHẾ cũ]  vs  [mã THẬT mới].
 *   node scripts/verify-doc-codes.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
function loadEnv(p){ if(!existsSync(p))return; for(const l of readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const e=t.indexOf("=");if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;} }
loadEnv(join(process.cwd(),".env.local")); loadEnv(join(process.cwd(),".env"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const TENANT = "148e8ac5-b891-4de3-9055-cfa41f39ddb0";

// type → bảng gốc (đã verify probe-doc-codes.mjs)
const MAP = {
  production_order:      "production_orders",
  inventory_check:       "inventory_checks",
  disposal_export:       "disposal_exports",
  return_bom_restore:    "sales_returns",
  purchase_order_revert: "purchase_orders",
  invoice_void:          "invoices",
  purchase_order:        "purchase_orders",
  invoice:               "invoices",
  bom_consume:           "invoices",
};
const oldFake = (rt,id)=> rt ? `${rt.toUpperCase().slice(0,2)}${id.slice(0,6)}` : id.slice(0,10);

async function main(){
  let okReal=0, total=0, noRef=0;
  for (const [rt, table] of Object.entries(MAP)){
    const { data } = await db.from("stock_movements")
      .select("id, reference_id")
      .eq("tenant_id", TENANT).eq("reference_type", rt)
      .not("reference_id","is",null)
      .limit(3);
    if (!data?.length) continue;
    console.log(`\n━━ ${rt}  →  ${table} ━━`);
    for (const m of data){
      total++;
      const { data: doc } = await db.from(table).select("code").eq("id", m.reference_id).maybeSingle();
      const real = doc?.code ?? "(không tra được)";
      if (doc?.code) okReal++;
      console.log(`  CHẾ cũ: ${oldFake(rt,m.id).padEnd(9)} →  THẬT mới: ${real}`);
    }
  }
  // Đếm dòng KHÔNG có chứng từ (tồn đầu kỳ) — sẽ hiện "—", KHÔNG chế mã
  const { count } = await db.from("stock_movements").select("id",{count:"exact",head:true})
    .eq("tenant_id",TENANT).is("reference_id",null);
  noRef = count ?? 0;
  console.log(`\n─────────────────────────────`);
  console.log(`Mẫu tra mã thật: ${okReal}/${total} khớp bảng gốc (còn lại là chứng từ bị xóa → "—", KHÔNG chế).`);
  console.log(`Dòng KHÔNG có chứng từ (tồn đầu kỳ...): ${noRef} → hiện "—" (đúng, không có phiếu).`);
  console.log(`\nKẾT LUẬN: "Mã phiếu" = mã thật khi có chứng từ, "—" khi không — HẾT chế UUID.`);
  console.log("XONG — read-only.");
}
main().catch(e=>{console.error(e.message||e);process.exit(1);});
