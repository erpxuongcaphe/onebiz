#!/usr/bin/env node
/**
 * READ-ONLY — sizing cho Thẻ kho Đợt 4 (cột Tồn cuối):
 *  1) Sổ mỗi (SP × chi nhánh) dài tối đa bao nhiêu? → quyết TS đủ hay cần RPC.
 *  2) Tồn cộng dồn TIẾN từ đầu sổ có = branch_stock không? (drift check mẫu).
 *  3) Có cụm trùng (SP,CN,created_at) cần tie-break (created_at,id) không?
 *   node scripts/probe-stock-card.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
function loadEnv(p){ if(!existsSync(p))return; for(const l of readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const e=t.indexOf("=");if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;} }
loadEnv(join(process.cwd(),".env.local")); loadEnv(join(process.cwd(),".env"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const TENANT = "148e8ac5-b891-4de3-9055-cfa41f39ddb0";
const fmt = (n)=> new Intl.NumberFormat("vi-VN",{maximumFractionDigits:3}).format(Number(n||0));

async function fetchAll(sel, filt){ let all=[],from=0; for(;;){ let q=db.from("stock_movements").select(sel).eq("tenant_id",TENANT); q=filt(q); const {data,error}=await q.order("created_at").range(from,from+999); if(error)throw error; all=all.concat(data); if(data.length<1000)break; from+=1000;} return all; }

async function main(){
  // 1) Kích thước sổ mỗi (product, branch)
  const rows = await fetchAll("product_id, branch_id, type, quantity, created_at, id", q=>q);
  console.log("Tổng dòng:", rows.length);
  const perPB = new Map(); // key product|branch → count
  const clusters = new Map(); // key product|branch|created_at → count (tie-break)
  for (const r of rows){
    const k = `${r.product_id}|${r.branch_id}`;
    perPB.set(k, (perPB.get(k)||0)+1);
    const ck = `${k}|${r.created_at}`;
    clusters.set(ck, (clusters.get(ck)||0)+1);
  }
  const sizes = [...perPB.values()].sort((a,b)=>b-a);
  console.log(`\nSố cặp (SP×CN): ${perPB.size}`);
  console.log(`Sổ DÀI NHẤT của 1 cặp: ${sizes[0]} dòng`);
  console.log(`Top 5 dài: ${sizes.slice(0,5).join(", ")}`);
  console.log(`Số cặp > 1000 dòng (cần loop phân trang): ${sizes.filter(s=>s>1000).length}`);
  const dupClusters = [...clusters.values()].filter(c=>c>1);
  console.log(`Cụm trùng (SP,CN,created_at) > 1 dòng: ${dupClusters.length} (max ${Math.max(0,...dupClusters)}) → BẮT BUỘC tie-break (created_at,id)`);

  // 2) Drift check: 3 cặp có sổ dài nhất — tồn cộng dồn tiến vs branch_stock
  const topKeys = [...perPB.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(e=>e[0]);
  console.log(`\n── Drift check 5 cặp sổ dài nhất (cộng dồn TIẾN vs branch_stock) ──`);
  for (const key of topKeys){
    const [pid, bid] = key.split("|");
    const led = rows.filter(r=>r.product_id===pid && (bid==="null"? r.branch_id===null : r.branch_id===bid))
      .sort((a,b)=> a.created_at<b.created_at?-1 : a.created_at>b.created_at?1 : (a.id<b.id?-1:1));
    let bal=0; for(const m of led){ bal += m.type==="out" ? -Number(m.quantity||0) : Number(m.quantity||0); }
    const { data: bs } = await db.from("branch_stock").select("quantity").eq("tenant_id",TENANT).eq("product_id",pid).eq("branch_id",bid).is("variant_id",null).maybeSingle();
    const { data: pr } = await db.from("products").select("code, name, stock").eq("id",pid).maybeSingle();
    const sys = bs ? Number(bs.quantity||0) : null;
    const drift = sys===null ? null : bal - sys;
    console.log(`  ${pr?.code||pid.slice(0,8)} @${bid.slice(0,8)}: ${led.length} dòng | cộng dồn=${fmt(bal)} | branch_stock=${sys===null?"(NULL)":fmt(sys)} | lệch=${drift===null?"?":fmt(drift)} ${drift!==null&&Math.abs(drift)<1e-6?"✅":"⚠️"}`);
  }
  console.log("\nKẾT LUẬN sizing: nếu sổ dài nhất < ~1000 → tính Tồn cuối bằng TS (fetch full ledger 1 cặp) đủ nhanh, KHÔNG cần RPC/migration.");
  console.log("XONG — read-only.");
}
main().catch(e=>{console.error(e.message||e);process.exit(1);});
