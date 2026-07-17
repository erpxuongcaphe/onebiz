#!/usr/bin/env node
/**
 * READ-ONLY — đối chiếu bucket XNT TRƯỚC/SAU khi sửa mapping (Thẻ kho Đợt 2).
 * Chạy trên đủ 100% dòng sổ (phân trang 1000). Điều kiện PASS:
 *   1) Tổng NHẬP và tổng XUẤT trước = sau (mapping chỉ CHUYỂN CỘT, không đổi tổng).
 *   2) Mọi chênh lệch cột phải giải thích được bằng các nhóm dòng đã biết.
 *   node scripts/verify-xnt-mapping.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
function loadEnv(p){ if(!existsSync(p))return; for(const l of readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const e=t.indexOf("=");if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;} }
loadEnv(join(process.cwd(),".env.local")); loadEnv(join(process.cwd(),".env"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const TENANT = "148e8ac5-b891-4de3-9055-cfa41f39ddb0";
const fmt = (n)=> new Intl.NumberFormat("vi-VN",{maximumFractionDigits:2}).format(Number(n||0));

// ── Mapping CŨ (chép nguyên từ xnt-report.ts trước Đợt 2) ──────────────────
function oldIn(rt){ if(!rt) return "other"; rt=rt.toLowerCase();
  if(rt==="purchase_entry"||rt==="purchase_order"||rt==="goods_receipt"||rt.startsWith("purchase_")) return "supplier";
  if(rt==="inventory_check"||rt==="stock_adjustment") return "check";
  if(rt==="sales_return"||rt==="invoice_void") return "return";
  if(rt==="transfer"||rt==="stock_transfer") return "transfer";
  if(rt.startsWith("production")) return "production";
  return "other"; }
function oldOut(rt){ if(!rt) return "other"; rt=rt.toLowerCase();
  if(rt==="invoice"||rt==="sale"||rt==="pos_sale") return "sale";
  if(rt==="disposal"||rt==="disposal_export") return "disposal";
  if(rt==="supplier_return"||rt==="purchase_return") return "supplier_return";
  if(rt==="inventory_check"||rt==="stock_adjustment") return "check";
  if(rt==="transfer"||rt==="stock_transfer") return "transfer";
  if(rt.startsWith("production")) return "production";
  if(rt==="internal_export"||rt==="internal_sale"||rt==="input_invoice") return "internal";
  return "other"; }

// ── Mapping MỚI (dự kiến commit 2) ─────────────────────────────────────────
function newIn(rt){ if(!rt) return "other"; rt=rt.toLowerCase();
  if(rt==="purchase_entry"||rt==="purchase_order"||rt==="goods_receipt") return "supplier";
  if(rt==="inventory_check"||rt==="stock_adjustment"||rt==="adjustment") return "check";
  if(rt==="sales_return"||rt==="invoice_void"||rt==="return_bom_restore") return "return";
  if(rt==="transfer"||rt==="stock_transfer") return "transfer";
  if(rt==="production_order"||rt==="production_complete"||rt==="production_reconcile"||rt==="production_consume") return "production";
  return "other"; }
function newOut(rt){ if(!rt) return "other"; rt=rt.toLowerCase();
  // CEO 17/07: tiêu hao công thức = BÁN (trừ NVL ngay lúc thanh toán, chứng từ = hóa đơn)
  if(rt==="invoice"||rt==="sale"||rt==="pos_sale"||rt==="bom_consume"||rt==="modifier_topping") return "sale";
  if(rt==="disposal"||rt==="disposal_export") return "disposal";
  if(rt==="supplier_return"||rt==="purchase_return"||rt==="purchase_order_revert") return "supplier_return";
  if(rt==="inventory_check"||rt==="stock_adjustment"||rt==="adjustment") return "check";
  if(rt==="transfer"||rt==="stock_transfer") return "transfer";
  if(rt==="production_order"||rt==="production_complete"||rt==="production_reconcile"||rt==="production_consume") return "production";
  if(rt==="internal_export"||rt==="internal_sale"||rt==="input_invoice") return "internal";
  return "other"; }

async function main(){
  let all=[],from=0;
  for(;;){const {data}=await db.from("stock_movements").select("type,reference_type,quantity").eq("tenant_id",TENANT).order("created_at").range(from,from+999); all=all.concat(data); if(data.length<1000)break; from+=1000;}
  console.log("Dòng sổ:",all.length,"\n");
  const agg = (mapI,mapO)=>{ const a={in:{},out:{}}; let tin=0,tout=0;
    all.forEach(r=>{ const q=Math.abs(Number(r.quantity||0));
      if(r.type==="in"){ const b=mapI(r.reference_type); a.in[b]=(a.in[b]||0)+q; tin+=q; }
      else if(r.type==="out"){ const b=mapO(r.reference_type); a.out[b]=(a.out[b]||0)+q; tout+=q; } });
    return {a,tin,tout}; };
  const O=agg(oldIn,oldOut), N=agg(newIn,newOut);
  const show=(t,x)=>{ console.log(t); ["in","out"].forEach(d=>{ Object.entries(x.a[d]).sort().forEach(([b,v])=>console.log(`  ${d.padEnd(3)} ${b.padEnd(16)} ${fmt(v).padStart(14)}`)); }); console.log(`  TỔNG NHẬP=${fmt(x.tin)} · TỔNG XUẤT=${fmt(x.tout)}\n`); };
  show("=== TRƯỚC (mapping cũ) ===",O);
  show("=== SAU (mapping mới) ===",N);
  const okIn = Math.abs(O.tin-N.tin)<1e-9, okOut = Math.abs(O.tout-N.tout)<1e-9;
  console.log(`INVARIANT tổng NHẬP giữ nguyên: ${okIn?"✅":"❌"} | tổng XUẤT giữ nguyên: ${okOut?"✅":"❌"}`);
  console.log("\nCHÊNH TỪNG CỘT (mới − cũ):");
  ["in","out"].forEach(d=>{ const ks=new Set([...Object.keys(O.a[d]),...Object.keys(N.a[d])]);
    [...ks].sort().forEach(b=>{ const diff=(N.a[d][b]||0)-(O.a[d][b]||0); if(Math.abs(diff)>1e-9) console.log(`  ${d.padEnd(3)} ${b.padEnd(16)} ${diff>0?"+":""}${fmt(diff)}`); }); });
  console.log("\nXONG — read-only.");
}
main().catch(e=>{console.error(e.message||e);process.exit(1);});
