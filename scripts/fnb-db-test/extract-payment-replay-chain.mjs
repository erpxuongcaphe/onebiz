import { readFileSync, writeFileSync } from "node:fs";

const name = "fnb_complete_payment_atomic_v3";
const signature = "uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text";
const definitions = [
  ["00343_fnb_payment_benefits_server_authority.sql", null],
  ["00345_harden_fnb_cashier_transaction_rpcs.sql", "_fnb_complete_payment_impl_00343"],
  ["00370_fnb_checkout_permission.sql", "_fnb_complete_payment_checkout_impl_00345"],
];

// Load whole production functions, including guards, rather than copying replay SQL.
const sql = definitions.map(([file, previousName]) => {
  const source = readFileSync(`supabase/migrations/${file}`, "utf8").replace(/\r\n/g, "\n");
  const marker = `create or replace function public.${name}(`;
  const start = source.indexOf(marker);
  const end = source.indexOf("\n$$;", start);
  if (start < 0 || end < 0 || source.indexOf(marker, start + 1) >= 0) {
    throw new Error(`Payment function boundary changed: ${file}`);
  }
  const rename = previousName
    ? `alter function public.${name}(${signature}) rename to ${previousName};\n`
    : "";
  return rename + source.slice(start, end + 4);
}).join("\n\n");

if (!process.argv[2]) throw new Error("Temporary SQL output path required");
writeFileSync(process.argv[2], sql + "\n", "utf8");
