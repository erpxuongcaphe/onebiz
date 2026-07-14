#!/usr/bin/env node
/** READ-ONLY — mô hình đơn↔hóa đơn: đơn source='order' khi completed có sổ (kho/thu) không? */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
function loadEnv(p){ if(!existsSync(p))return; for(const l of readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim(); if(!t||t.startsWith("#"))continue; const e=t.indexOf("="); if(e<0)continue; const k=t.slice(0,e).trim(); let v=t.slice(e+1).trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); if(!process.env[k])process.env[k]=v; } }
loadEnv(join(process.cwd(),".env.local")); loadEnv(join(process.cwd(),".env"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const fmt=(n)=>new Intl.NumberFormat("vi-VN").format(Math.round(Number(n||0)));

async function main(){
  // Phân bố status theo source
  console.log("=== SỐ HÓA ĐƠN/ĐƠN theo source × status ===");
  for (const src of ["order","pos","sale",null]) {
    let q = db.from("invoices").select("status", { count:"exact" }).is("deleted_at", null);
    q = src === null ? q.is("source", null) : q.eq("source", src);
    const { data, count } = await q.limit(5000);
    if ((count ?? 0) === 0) continue;
    const byStatus = {};
    (data ?? []).forEach(r => { byStatus[r.status] = (byStatus[r.status]||0)+1; });
    console.log(`  source=${src ?? "null"}: tổng ${count} → ${JSON.stringify(byStatus)}`);
  }

  // Với đơn source='order' đã completed: có sổ kho/thu không?
  console.log("\n=== ĐƠN source='order' status='completed' — có sổ không? ===");
  const { data: doneOrders } = await db.from("invoices")
    .select("id, code, order_code, total, created_at")
    .eq("source","order").eq("status","completed").is("deleted_at",null)
    .order("created_at",{ascending:false}).limit(8);
  if (!doneOrders || doneOrders.length === 0) {
    console.log("  → 0 đơn source='order' completed. (Có thể đơn hoàn thành được đổi source, hoặc luôn tạo hóa đơn riêng.)");
  }
  for (const o of (doneOrders ?? [])) {
    const { count: sm } = await db.from("stock_movements").select("id",{count:"exact",head:true}).eq("reference_id", o.id);
    const { count: cash } = await db.from("cash_transactions").select("id",{count:"exact",head:true}).eq("reference_id", o.id);
    console.log(`  · ${o.order_code||o.code} total=${fmt(o.total)} → stock_movements=${sm ?? 0}, cash=${cash ?? 0}`);
  }

  // Có cột nào nối order→invoice? kiểm vài cột khả dĩ
  console.log("\n=== Cột nối order↔invoice (nếu có) ===");
  const { data: sample } = await db.from("invoices").select("*").eq("source","pos").eq("status","completed").limit(1).maybeSingle();
  if (sample) {
    const keys = Object.keys(sample).filter(k => /order|source|parent|origin|ref/i.test(k));
    console.log("  cột liên quan:", keys.join(", ") || "(không thấy cột nối rõ)");
    console.log("  HD mẫu order_code =", sample.order_code, " | source =", sample.source);
  }
  console.log("\nXONG — read-only.");
}
main().catch(e=>{console.error(e.message||e);process.exit(1);});
