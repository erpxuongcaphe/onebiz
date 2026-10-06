import {readFileSync,writeFileSync} from "node:fs";
const sources=[
  ["00287_complete_fifo_workflow_coverage.sql","apply_manual_stock_movement_atomic"],
  ["00011_atomic_stock_rpcs.sql","increment_product_stock"],
  ["00156_branch_stock_null_variant_guard.sql","upsert_branch_stock"],
  ["00390_fnb_branch_cost_ledger.sql","_fnb_branch_cost_tracking_enabled_00390"],
  ["00390_fnb_branch_cost_ledger.sql","_post_fnb_branch_cost_in_00390"],
];
const sql=sources.map(([file,name])=>{
  const source=readFileSync(`supabase/migrations/${file}`,"utf8");
  const pattern=new RegExp(`create (?:or replace )?function public\\.${name}\\(`,"i");
  const match=pattern.exec(source);if(!match)throw new Error(`Missing ${name}`);
  const tail=source.slice(match.index);const delimiter=/\bas\s+(\$[a-z_]*\$)/i.exec(tail);
  const end=delimiter&&tail.indexOf(`${delimiter[1]};`,delimiter.index+delimiter[0].length);
  if(!delimiter||end<0)throw new Error(`Boundary ${name}`);
  return tail.slice(0,end+delimiter[1].length+1);
}).join("\n\n");
writeFileSync(process.argv[2],sql,"utf8");
