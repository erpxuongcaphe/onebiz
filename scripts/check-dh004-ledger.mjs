#!/usr/bin/env node
/** READ-ONLY — soi sổ DH000004 vs HD001430 để biết cách gộp đúng. Không ghi. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
function loadEnv(p){ if(!existsSync(p))return; for(const l of readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim(); if(!t||t.startsWith("#"))continue; const e=t.indexOf("="); if(e<0)continue; const k=t.slice(0,e).trim(); let v=t.slice(e+1).trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); if(!process.env[k])process.env[k]=v; } }
loadEnv(join(process.cwd(),".env.local")); loadEnv(join(process.cwd(),".env"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const fmt=(n)=>new Intl.NumberFormat("vi-VN").format(Math.round(Number(n||0)));

async function main(){
  for (const code of ["DH000004","HD001430"]) {
    const { data: inv } = await db.from("invoices")
      .select("id, code, order_code, source, status, total, paid, debt, customer_id, customer_name, client_session_id, shift_id, created_at")
      .or(`code.eq.${code},order_code.eq.${code}`).limit(1).maybeSingle();
    if (!inv) { console.log(`\n### ${code}: KHÔNG tìm thấy`); continue; }
    console.log(`\n### ${code}  (id=${inv.id})`);
    console.log(`  source=${inv.source} status=${inv.status} total=${fmt(inv.total)} paid=${fmt(inv.paid)} debt=${fmt(inv.debt)}`);
    console.log(`  khách=${inv.customer_name} shift=${inv.shift_id? inv.shift_id.slice(0,8):"null"} tạo=${String(inv.created_at).slice(0,16).replace("T"," ")}`);
    const { count: itemN } = await db.from("invoice_items").select("id",{count:"exact",head:true}).eq("invoice_id", inv.id);
    console.log(`  số dòng hàng (invoice_items): ${itemN ?? 0}`);
    // stock_movements tham chiếu hóa đơn này?
    const { count: smN } = await db.from("stock_movements").select("id",{count:"exact",head:true}).eq("reference_id", inv.id);
    console.log(`  stock_movements (trừ kho) tham chiếu: ${smN ?? 0}`);
    // cash_transactions tham chiếu?
    const { count: cashN } = await db.from("cash_transactions").select("id",{count:"exact",head:true}).eq("reference_id", inv.id);
    console.log(`  cash_transactions (phiếu thu) tham chiếu: ${cashN ?? 0}`);
  }
  console.log("\nXONG — read-only.");
}
main().catch(e=>{console.error(e.message||e);process.exit(1);});
