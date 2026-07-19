#!/usr/bin/env node
/**
 * READ-ONLY — verify DOCUMENT_CONFIG của ChatGPT (stock-documents.ts) khớp DB
 * THẬT: mỗi loại chứng từ có bảng header + bảng item + đúng khóa ngoại không?
 * Nếu SAI → bấm mở chứng từ loại đó sẽ báo lỗi (không crash, nhưng hỏng UX).
 *   node scripts/probe-doc-config.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
function loadEnv(p){ if(!existsSync(p))return; for(const l of readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const e=t.indexOf("=");if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;} }
loadEnv(join(process.cwd(),".env.local")); loadEnv(join(process.cwd(),".env"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });

// CHÉP NGUYÊN từ stock-documents.ts DOCUMENT_CONFIG của ChatGPT
const CONFIG = {
  invoice: ["invoices","invoice_items","invoice_id"],
  purchase_order: ["purchase_orders","purchase_order_items","purchase_order_id"],
  input_invoice: ["input_invoices",null,null],
  production_order: ["production_orders","production_order_materials","production_order_id"],
  inventory_check: ["inventory_checks","inventory_check_items","check_id"],
  disposal_export: ["disposal_exports","disposal_export_items","disposal_id"],
  sales_return: ["sales_returns","return_items","return_id"],
  internal_sale: ["internal_sales","internal_sale_items","internal_sale_id"],
  internal_export: ["internal_exports","internal_export_items","export_id"],
  stock_transfer: ["stock_transfers","stock_transfer_items","transfer_id"],
  supplier_return: ["supplier_returns","supplier_return_items","return_id"],
};
// Bảng resolver codeOnlyLoaders của ChatGPT thêm (cần có cột code)
const RESOLVER_TABLES = ["supplier_returns","internal_exports","stock_transfers"];

async function tableCol(tbl, col){
  try { const { error } = await db.from(tbl).select(col).limit(1);
    if (error) return { ok:false, msg: error.message.slice(0,55) };
    return { ok:true };
  } catch(e){ return { ok:false, msg:(e.message||"").slice(0,55) }; }
}

async function main(){
  console.log("═══ HEADER + ITEM TABLE + FOREIGN KEY ═══\n");
  for (const [kind,[ht,it,fk]] of Object.entries(CONFIG)){
    const h = await tableCol(ht,"id, code");
    let line = `${kind.padEnd(17)} header ${ht.padEnd(20)} ${h.ok?"✅":"❌ "+h.msg}`;
    console.log(line);
    if (it && fk){
      const i = await tableCol(it, fk);
      console.log(`${"".padEnd(17)} item   ${it.padEnd(20)} .${fk.padEnd(22)} ${i.ok?"✅":"❌ "+i.msg}`);
    } else {
      console.log(`${"".padEnd(17)} item   (dùng PO liên kết)`);
    }
  }
  console.log("\n═══ RESOLVER codeOnlyLoaders (cần cột code) ═══\n");
  for (const t of RESOLVER_TABLES){
    const r = await tableCol(t,"id, code");
    console.log(`${t.padEnd(22)} ${r.ok?"✅ có bảng + cột code":"❌ "+r.msg}`);
  }
  console.log("\nXONG — read-only.");
}
main().catch(e=>{console.error(e.message||e);process.exit(1);});
