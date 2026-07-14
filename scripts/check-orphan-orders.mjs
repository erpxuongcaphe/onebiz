#!/usr/bin/env node
/**
 * READ-ONLY — tìm ĐƠN ĐẶT HÀNG (source='order') còn kẹt "chưa hoàn thành"
 * có thể là nạn nhân bug "Xử lý đặt hàng" (đơn gốc không flip completed).
 * KHÔNG ghi gì. node scripts/check-orphan-orders.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
function loadEnv(p){ if(!existsSync(p))return; for(const line of readFileSync(p,"utf8").split(/\r?\n/)){const t=line.trim(); if(!t||t.startsWith("#"))continue; const e=t.indexOf("="); if(e<0)continue; const k=t.slice(0,e).trim(); let v=t.slice(e+1).trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); if(!process.env[k])process.env[k]=v; } }
loadEnv(join(process.cwd(),".env.local")); loadEnv(join(process.cwd(),".env"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const fmt = (n)=> new Intl.NumberFormat("vi-VN").format(Math.round(Number(n||0)));

async function main(){
  console.log("TÌM ĐƠN ĐẶT HÀNG KẸT (source='order' chưa hoàn thành) — READ-ONLY\n");

  // Đơn đặt hàng còn mở (chưa completed/cancelled), chưa xóa mềm
  const { data: openOrders, error } = await db
    .from("invoices")
    .select("code, order_code, status, total, customer_name, client_session_id, created_at")
    .eq("source", "order")
    .not("status", "in", "(completed,cancelled)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) { console.log("Lỗi đọc:", error.message); return; }

  console.log(`Đơn đặt hàng CÒN MỞ (chưa hoàn thành): ${openOrders?.length ?? 0}`);
  (openOrders ?? []).forEach((o) => {
    const d = String(o.created_at).slice(0, 16).replace("T", " ");
    console.log(`  · ${o.order_code || o.code}  [${o.status}]  ${fmt(o.total)}đ  ${o.customer_name || "—"}  ${d}  sess=${o.client_session_id ? o.client_session_id.slice(0,8) : "null"}`);
  });

  // Hóa đơn hoàn tất từ NHÁP hôm nay (source pos/draft) — để đối chiếu orphan
  const today = new Date().toISOString().slice(0, 10);
  const { data: doneToday } = await db
    .from("invoices")
    .select("code, source, total, customer_name, client_session_id, created_at")
    .eq("status", "completed")
    .gte("created_at", today + "T00:00:00")
    .order("created_at", { ascending: false })
    .limit(40);
  console.log(`\nHóa đơn HOÀN TẤT hôm nay (đối chiếu): ${doneToday?.length ?? 0}`);
  (doneToday ?? []).forEach((o) => {
    const d = String(o.created_at).slice(11, 16);
    console.log(`  · ${o.code}  [src=${o.source}]  ${fmt(o.total)}đ  ${o.customer_name || "—"}  ${d}  sess=${o.client_session_id ? o.client_session_id.slice(0,8) : "null"}`);
  });
  console.log("\nGỢI Ý: đơn CÒN MỞ có total + khách + giờ trùng 1 hóa đơn HOÀN TẤT hôm nay → chính là đơn bị mồ côi (đã bán qua hóa đơn kia, đơn gốc kẹt). XONG — không ghi gì.");
}
main().catch((e)=>{console.error(e);process.exit(1);});
