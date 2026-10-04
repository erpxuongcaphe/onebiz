import { readFileSync, writeFileSync } from "node:fs";

const sources = [
  ["00011_atomic_stock_rpcs.sql", "increment_product_stock"],
  ["00156_branch_stock_null_variant_guard.sql", "upsert_branch_stock"],
  ["00147_variant_aware_bom_lookup.sql", "get_active_bom_for_branch"],
  ["00142_block_expired_lots_fifo.sql", "allocate_lots_fifo"],
  ["00165_fnb_menu_lock_cascade_void_ledger.sql", "should_cascade_bom_at_branch"],
  ["00350_fnb_exact_modifier_bom_quantities.sql", "consume_bom_for_sale"],
  ["00230_fix_fnb_double_pay_guard.sql", "fnb_complete_payment_atomic"],
];
const sql = sources.map(([file, name]) => {
  const source = readFileSync(`supabase/migrations/${file}`, "utf8").replace(/\r\n/g, "\n");
  const marker = `create or replace function public.${name}(`;
  const start = source.indexOf(marker);
  const tail = source.slice(start);
  const delimiter = /\bas\s+(\$[a-z_]*\$)/i.exec(tail);
  const end = delimiter && tail.indexOf(`${delimiter[1]};`, delimiter.index + delimiter[0].length);
  if (start < 0 || !delimiter || end < 0 || source.indexOf(marker, start + 1) >= 0) {
    throw new Error(`Posting function boundary changed: ${file} ${name}`);
  }
  const definition = tail.slice(0, end + delimiter[1].length + 1);
  return name === "fnb_complete_payment_atomic"
    ? definition.replace(marker, "create or replace function public._fnb_complete_payment_impl_00230(")
    : definition;
}).join("\n\n");
if (!process.argv[2]) throw new Error("Temporary SQL output path required");
writeFileSync(process.argv[2], sql + "\n", "utf8");
