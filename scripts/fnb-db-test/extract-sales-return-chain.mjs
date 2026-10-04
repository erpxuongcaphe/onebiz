import { readFileSync, writeFileSync } from "node:fs";

const sources = [
  ["00284_fifo_ledger_transaction_alignment.sql", "_reconcile_product_lots_to_branch_00284"],
  ["00381_allow_customer_credit_on_sales_return.sql", "_create_sales_return_auth_impl_00244"],
  ["00376_round_sales_return_refund_amount.sql", "create_sales_return_atomic", "_create_sales_return_atomic_impl_00376"],
  ["00388_close_fnb_kitchen_order_on_full_sales_return.sql", "create_sales_return_atomic"],
];
const definitions = sources.map(([file, name, rename]) => {
  const source = readFileSync(`supabase/migrations/${file}`, "utf8").replace(/\r\n/g, "\n");
  const marker = `create or replace function public.${name}(`;
  const start = source.indexOf(marker);
  const tail = source.slice(start);
  const delimiter = /\bas\s+(\$[a-z_]*\$)/i.exec(tail);
  const end = delimiter && tail.indexOf(`${delimiter[1]};`, delimiter.index + delimiter[0].length);
  if (start < 0 || !delimiter || end < 0 || source.indexOf(marker, start + 1) >= 0) {
    throw new Error(`Sales return function boundary changed: ${file} ${name}`);
  }
  const definition = tail.slice(0, end + delimiter[1].length + 1);
  return rename ? definition.replace(marker, `create or replace function public.${rename}(`) : definition;
});
if (!process.argv[2]) throw new Error("Temporary SQL output path required");
writeFileSync(process.argv[2], definitions.join("\n\n") + "\n", "utf8");
