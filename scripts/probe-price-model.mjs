#!/usr/bin/env node
/**
 * READ-ONLY — khảo sát mô hình GIÁ cho Thẻ kho Đợt 6:
 *  1) stock_movements có cột giá không? (unit_cost/unit_price/total)
 *  2) Giá VỐN xuất lấy đâu: products.cost_price? audit_log WAC?
 *  3) Giá NHẬP theo đợt lấy đâu: purchase_order_items.unit_price?
 *   node scripts/probe-price-model.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
function loadEnv(p){ if(!existsSync(p))return; for(const l of readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const e=t.indexOf("=");if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;} }
loadEnv(join(process.cwd(),".env.local")); loadEnv(join(process.cwd(),".env"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const TENANT = "148e8ac5-b891-4de3-9055-cfa41f39ddb0";

async function cols(tbl){
  const { data } = await db.from(tbl).select("*").eq("tenant_id",TENANT).limit(1);
  return data?.[0] ? Object.keys(data[0]) : [];
}

async function main(){
  console.log("═══ 1) stock_movements CÓ cột giá không? ═══");
  const smCols = await cols("stock_movements");
  const priceCols = smCols.filter(c=>/cost|price|amount|value|total/i.test(c));
  console.log("Tất cả cột:", smCols.join(", "));
  console.log("→ Cột liên quan giá:", priceCols.length ? priceCols.join(", ") : "KHÔNG CÓ (cần suy ra từ nguồn khác)");

  console.log("\n═══ 2) Giá VỐN (cho dòng XUẤT) ═══");
  const { data: pr } = await db.from("products").select("id,code,cost_price").eq("tenant_id",TENANT).eq("code","NVL-CPH-002").maybeSingle();
  console.log(`products.cost_price NVL-CPH-002 = ${pr?.cost_price} (giá vốn hiện tại — WAC)`);
  const { count: alCount } = await db.from("audit_log").select("id",{count:"exact",head:true}).eq("tenant_id",TENANT).eq("action","cost_price_update");
  console.log(`audit_log cost_price_update: ${alCount ?? 0} bản ghi (lịch sử WAC theo thời điểm)`);

  console.log("\n═══ 3) Giá NHẬP theo đợt (cho dòng NHẬP) ═══");
  const poiCols = await cols("purchase_order_items");
  console.log("purchase_order_items cột:", poiCols.filter(c=>/price|cost|qty|quantity|product/i.test(c)).join(", "));
  const { count: poiCount } = await db.from("purchase_order_items").select("id",{count:"exact",head:true}).eq("tenant_id",TENANT);
  console.log(`purchase_order_items: ${poiCount ?? 0} dòng (giá nhập từng đợt)`);

  console.log("\nKẾT LUẬN: stock_movements KHÔNG có giá → Đợt 6 hoặc (A) hiển thị suy ra khi đọc");
  console.log("(xuất=cost_price, nhập=PO unit_price) — KHÔNG migration; hoặc (B) ghi cột lúc tạo — nặng.");
  console.log("XONG — read-only.");
}
main().catch(e=>{console.error(e.message||e);process.exit(1);});
