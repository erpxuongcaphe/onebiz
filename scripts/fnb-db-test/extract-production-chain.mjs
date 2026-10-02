import { readFileSync, writeFileSync } from "node:fs";

const definitions = [
  ["00150_production_created_by_guard.sql", "consume_production_materials"],
  ["00158_reconcile_sx000011_complete_yaourt.sql", "complete_production_order"],
  ["00283_harden_production_order_lifecycle.sql", "complete_production_atomic"],
  ["00284_fifo_ledger_transaction_alignment.sql", "complete_production_atomic"],
];

function extract(file, name) {
  const source = readFileSync(`supabase/migrations/${file}`, "utf8");
  const marker = `create or replace function public.${name}(`;
  const start = source.indexOf(marker);
  const end = source.indexOf("\n$$;", start);
  if (start < 0 || end < 0 || source.indexOf(marker, start + 1) >= 0) {
    throw new Error(`Production function boundary changed: ${file} ${name}`);
  }
  return source.slice(start, end + 4);
}

if (!process.argv[2]) throw new Error("Temporary SQL output path required");
const sql = definitions.map(([file, name], index) => {
  const definition = extract(file, name);
  return index === 3
    ? `alter function public.complete_production_atomic(uuid,numeric,text,date,date) rename to _complete_production_auth_impl_00283;\n${definition}`
    : definition;
}).join("\n\n");
writeFileSync(process.argv[2], sql + "\n", "utf8");
