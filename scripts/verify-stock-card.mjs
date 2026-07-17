#!/usr/bin/env node
/**
 * READ-ONLY — mô phỏng ĐÚNG logic getStockCard (Đợt 4) cho 1 cặp SP×CN:
 * cộng dồn tiến (created_at,id) → in vài dòng CUỐI kèm "Tồn cuối" + đối soát
 * dòng mới nhất = branch_stock. Cho thấy đúng cột UI sẽ hiển thị.
 *   node scripts/verify-stock-card.mjs [productCode] [branchName?]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
function loadEnv(p){ if(!existsSync(p))return; for(const l of readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const e=t.indexOf("=");if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;} }
loadEnv(join(process.cwd(),".env.local")); loadEnv(join(process.cwd(),".env"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const TENANT = "148e8ac5-b891-4de3-9055-cfa41f39ddb0";
const fmt = (n)=> new Intl.NumberFormat("vi-VN",{maximumFractionDigits:3}).format(Number(n||0));
const CODE = process.argv[2] || "NVL-CPH-002";

async function main(){
  const { data: pr } = await db.from("products").select("id, code, name, unit, stock").eq("tenant_id",TENANT).eq("code",CODE).maybeSingle();
  if(!pr){ console.log("Không thấy SP", CODE); return; }
  // Chi nhánh có tồn cao nhất cho SP này (thường Kho Tổng)
  const { data: bsAll } = await db.from("branch_stock").select("branch_id, quantity, branches(name)").eq("tenant_id",TENANT).eq("product_id",pr.id).is("variant_id",null);
  const target = (bsAll||[]).sort((a,b)=>Number(b.quantity)-Number(a.quantity))[0];
  if(!target){ console.log("SP không có branch_stock"); return; }
  const bid = target.branch_id, bname = target.branches?.name || bid.slice(0,8);

  // Fetch full ledger (tăng dần created_at,id) — giống getStockCard
  let led=[],from=0;
  for(;;){ const {data}=await db.from("stock_movements").select("id,type,quantity,reference_type,note,created_at").eq("tenant_id",TENANT).eq("product_id",pr.id).eq("branch_id",bid).order("created_at",{ascending:true}).order("id",{ascending:true}).range(from,from+999); led=led.concat(data); if(data.length<1000)break; from+=1000; }

  let bal=0; const withBal = led.map(m=>{ bal += m.type==="out" ? -Number(m.quantity||0) : Number(m.quantity||0); return {...m, run: bal}; });
  const finalBal = bal, sys = Number(target.quantity||0);

  console.log(`THẺ KHO  ${pr.code} — ${pr.name}  @ ${bname}  (${led.length} dòng)\n`);
  console.log(`${"Thời gian".padEnd(17)} ${"Loại".padEnd(6)} ${"SL".padStart(10)} ${"Tồn cuối".padStart(12)}`);
  console.log("─".repeat(50));
  for(const m of withBal.slice(-8)){
    const q = (m.type==="out"?"-":"+") + fmt(m.quantity);
    console.log(`${new Date(m.created_at).toLocaleString("vi-VN").padEnd(17)} ${(m.type==="out"?"Xuất":"Nhập").padEnd(6)} ${q.padStart(10)} ${fmt(m.run).padStart(12)}`);
  }
  console.log("─".repeat(50));
  const ok = Math.abs(finalBal - sys) < 1e-6;
  console.log(`Tồn cuối dòng mới nhất = ${fmt(finalBal)} ${pr.unit||""}`);
  console.log(`branch_stock hệ thống  = ${fmt(sys)} ${pr.unit||""}`);
  console.log(`→ ${ok ? "✅ KHỚP — sổ không lệch" : `⚠️ LỆCH ${fmt(finalBal-sys)} → băng cảnh báo sẽ hiện`}`);
  console.log("\nXONG — read-only.");
}
main().catch(e=>{console.error(e.message||e);process.exit(1);});
